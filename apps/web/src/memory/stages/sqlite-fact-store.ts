import type { Database } from 'better-sqlite3'

import type {
  Embedder,
  Fact,
  FactFilter,
  FactQuery,
  FactStore,
  Scope,
} from '@tanstack/ai-memory'

import {
  EMBEDDING_DIM,
  l2DistanceToSimilarity,
  toVecBuffer,
} from './openai-embedder'

const DEFAULT_SEARCH_LIMIT = 8
const ID_COLUMN_PRECISION_HINT = 'TEXT'

export interface SqliteFactStoreConfig {
  /**
   * Resolve the SQLite database for a given scope. The store calls this on
   * every operation, so callers can multiplex over per-session db files
   * without recreating the store. Each db must have sqlite-vec loaded and
   * be ready to accept the store's schema.
   */
  getDb: (scope: Scope) => Database
  embedder: Embedder
  /**
   * Advisory similarity threshold. Stored on the configuration and surfaced
   * via `getSimilarityThreshold()` so consolidators can read it; not enforced
   * by `searchFacts` itself (which always returns top-K with `metadata.similarity`).
   */
  similarityThreshold?: number
}

const SCHEMA_APPLIED = new WeakSet<Database>()

function ensureSchema(db: Database): void {
  if (SCHEMA_APPLIED.has(db)) return
  db.exec(`CREATE TABLE IF NOT EXISTS tanmemory_memories (
    id ${ID_COLUMN_PRECISION_HINT} PRIMARY KEY NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    tags TEXT,
    entities TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    updated_at TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    superseded_by TEXT
  )`)
  db.exec(
    'CREATE INDEX IF NOT EXISTS tanmemory_memories_active_idx ON tanmemory_memories (superseded_by)',
  )
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS tanmemory_vec USING vec0(
    memory_id TEXT PRIMARY KEY,
    embedding FLOAT[${EMBEDDING_DIM}]
  )`)
  SCHEMA_APPLIED.add(db)
}

interface Row {
  id: string
  content: string
  source: string
  tags: string | null
  entities: string | null
  metadata: string | null
  created_at: string
  updated_at: string
  superseded_by: string | null
}

function rowToFact(row: Row, similarity?: number): Fact {
  const metadata: Record<string, unknown> = row.metadata
    ? safeParse<Record<string, unknown>>(row.metadata, {})
    : {}
  if (typeof similarity === 'number') {
    metadata.similarity = similarity
  }
  if (row.source && metadata.source === undefined) {
    metadata.source = row.source
  }
  return {
    id: row.id,
    text: row.content,
    tags: row.tags ? safeParse<Array<string>>(row.tags, []) : undefined,
    entities: row.entities
      ? safeParse<Array<string>>(row.entities, [])
      : undefined,
    metadata,
    createdAt: parseSqliteDate(row.created_at),
    supersededBy: row.superseded_by ?? undefined,
  }
}

function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function parseSqliteDate(text: string): Date {
  // SQLite CURRENT_TIMESTAMP returns 'YYYY-MM-DD HH:MM:SS' (UTC, no TZ).
  // Coerce to ISO so JS parses it as UTC consistently.
  const iso = /\d{4}-\d{2}-\d{2}T/.test(text)
    ? text
    : text.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? new Date() : d
}

function applyFactFilter(facts: Array<Fact>, filter?: FactFilter): Array<Fact> {
  if (!filter) return facts
  return facts.filter((f) => {
    if (!filter.includeSuperseded && f.supersededBy) return false
    if (filter.createdAfter && f.createdAt < filter.createdAfter) return false
    if (filter.createdBefore && f.createdAt > filter.createdBefore) return false
    if (filter.tags && filter.tags.length > 0) {
      const factTags = new Set(f.tags ?? [])
      if (!filter.tags.some((t) => factTags.has(t))) return false
    }
    if (filter.entities && filter.entities.length > 0) {
      const factEntities = new Set(f.entities ?? [])
      if (!filter.entities.some((e) => factEntities.has(e))) return false
    }
    return true
  })
}

/**
 * Per-session SQLite-backed FactStore.
 *
 * Schema (per-session db file):
 *   tanmemory_memories(id, content, source, tags, entities, metadata,
 *                      created_at, updated_at, superseded_by)
 *   tanmemory_vec(memory_id, embedding FLOAT[1536])  -- sqlite-vec virtual table
 *
 * `searchFacts` does KNN via sqlite-vec + filters out superseded entries.
 * Each returned Fact carries `metadata.similarity` for downstream consumers
 * (e.g. a consolidator deciding whether to ask the LLM).
 */
export function createSqliteFactStore(
  config: SqliteFactStoreConfig,
): FactStore & { getSimilarityThreshold(): number | undefined } {
  const similarityThreshold = config.similarityThreshold

  function dbFor(scope: Scope): Database {
    const db = config.getDb(scope)
    ensureSchema(db)
    return db
  }

  async function embedOne(text: string): Promise<Float32Array> {
    const [vec] = await config.embedder.embed([text])
    if (!vec) throw new Error('embedder returned no vectors')
    return vec
  }

  return {
    getSimilarityThreshold() {
      return similarityThreshold
    },

    async storeFact(scope: Scope, fact: Fact): Promise<void> {
      const db = dbFor(scope)
      const existing = db
        .prepare('SELECT id FROM tanmemory_memories WHERE id = ?')
        .get(fact.id) as { id: string } | undefined
      const tags = fact.tags ? JSON.stringify(fact.tags) : null
      const entities = fact.entities ? JSON.stringify(fact.entities) : null
      const cleanMetadata: Record<string, unknown> = { ...(fact.metadata ?? {}) }
      delete cleanMetadata.similarity
      const metadata = Object.keys(cleanMetadata).length
        ? JSON.stringify(cleanMetadata)
        : null
      const source =
        (cleanMetadata.source as string | undefined) ?? 'middleware'
      const createdAt = fact.createdAt.toISOString()

      if (existing) {
        db.prepare(
          `UPDATE tanmemory_memories
           SET content = ?, source = ?, tags = ?, entities = ?, metadata = ?,
               updated_at = CURRENT_TIMESTAMP, superseded_by = ?
           WHERE id = ?`,
        ).run(
          fact.text,
          source,
          tags,
          entities,
          metadata,
          fact.supersededBy ?? null,
          fact.id,
        )
      } else {
        db.prepare(
          `INSERT INTO tanmemory_memories
             (id, content, source, tags, entities, metadata, created_at, superseded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          fact.id,
          fact.text,
          source,
          tags,
          entities,
          metadata,
          createdAt,
          fact.supersededBy ?? null,
        )
      }

      // Maintain the vec table only for active (non-superseded) facts. We embed
      // the fact's current text on each write so merge updates stay in sync.
      if (fact.supersededBy) {
        db.prepare('DELETE FROM tanmemory_vec WHERE memory_id = ?').run(fact.id)
      } else {
        const vec = await embedOne(fact.text)
        db.prepare('DELETE FROM tanmemory_vec WHERE memory_id = ?').run(fact.id)
        db.prepare(
          'INSERT INTO tanmemory_vec(memory_id, embedding) VALUES (?, ?)',
        ).run(fact.id, toVecBuffer(vec))
      }
    },

    async getFact(scope: Scope, id: string): Promise<Fact | null> {
      const db = dbFor(scope)
      const row = db
        .prepare(
          `SELECT id, content, source, tags, entities, metadata, created_at,
                  updated_at, superseded_by
             FROM tanmemory_memories WHERE id = ?`,
        )
        .get(id) as Row | undefined
      if (!row) return null
      return rowToFact(row)
    },

    async searchFacts(scope: Scope, query: FactQuery): Promise<Array<Fact>> {
      const db = dbFor(scope)
      const limit = query.limit ?? DEFAULT_SEARCH_LIMIT
      if (!query.text) {
        return (await this.listFacts(scope, query.filter)).slice(0, limit)
      }
      const vec = await embedOne(query.text)
      const hits = db
        .prepare(
          `SELECT memory_id, distance
             FROM tanmemory_vec
             WHERE embedding MATCH ?
             ORDER BY distance
             LIMIT ?`,
        )
        .all(toVecBuffer(vec), BigInt(limit)) as Array<{
        memory_id: string
        distance: number
      }>
      if (hits.length === 0) return []
      const placeholders = hits.map(() => '?').join(',')
      const rows = db
        .prepare(
          `SELECT id, content, source, tags, entities, metadata, created_at,
                  updated_at, superseded_by
             FROM tanmemory_memories
             WHERE id IN (${placeholders})`,
        )
        .all(...hits.map((h) => h.memory_id)) as Array<Row>
      const byId = new Map(rows.map((r) => [r.id, r] as const))
      const facts: Array<Fact> = []
      for (const h of hits) {
        const row = byId.get(h.memory_id)
        if (!row) continue
        if (row.superseded_by) continue
        facts.push(rowToFact(row, l2DistanceToSimilarity(h.distance)))
      }
      return applyFactFilter(facts, query.filter)
    },

    async listFacts(scope: Scope, filter?: FactFilter): Promise<Array<Fact>> {
      const db = dbFor(scope)
      const rows = db
        .prepare(
          `SELECT id, content, source, tags, entities, metadata, created_at,
                  updated_at, superseded_by
             FROM tanmemory_memories`,
        )
        .all() as Array<Row>
      const facts = rows.map((r) => rowToFact(r))
      const withDefaultFilter: FactFilter = {
        ...filter,
        includeSuperseded: filter?.includeSuperseded ?? false,
      }
      return applyFactFilter(facts, withDefaultFilter)
    },

    async deleteFact(scope: Scope, id: string): Promise<void> {
      const db = dbFor(scope)
      db.prepare('DELETE FROM tanmemory_memories WHERE id = ?').run(id)
      db.prepare('DELETE FROM tanmemory_vec WHERE memory_id = ?').run(id)
    },
  }
}
