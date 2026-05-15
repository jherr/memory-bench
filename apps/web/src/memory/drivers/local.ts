import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import * as sqliteVec from 'sqlite-vec'

import {
  createComposedDriver,
  type MemoryDriver,
  type Scope,
} from '@tanstack/ai-memory'

import { createAnthropicExtractor } from '../stages/anthropic-extractor'
import { createBulletRenderer } from '../stages/bullet-list-renderer'
import { createOpenAIEmbedder } from '../stages/openai-embedder'
import { createSimpleConsolidator } from '../stages/simple-consolidator'
import { createSqliteFactStore } from '../stages/sqlite-fact-store'

const SESSIONS_DIR = path.resolve(
  process.env.LOCAL_SESSIONS_DIR ??
    path.join(process.cwd(), 'data', 'local-sessions'),
)
const CACHE_CAP = 16

type Entry = {
  db: Database.Database
  lastUsed: number
}

const cache = new Map<string, Entry>()

function ensureSessionsDir(): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
}

function evictIfNeeded(): void {
  if (cache.size <= CACHE_CAP) return
  let oldestKey: string | null = null
  let oldestTime = Infinity
  for (const [k, v] of cache) {
    if (v.lastUsed < oldestTime) {
      oldestTime = v.lastUsed
      oldestKey = k
    }
  }
  if (oldestKey) {
    cache.get(oldestKey)?.db.close()
    cache.delete(oldestKey)
  }
}

function openSession(sessionId: string): Database.Database {
  const cached = cache.get(sessionId)
  if (cached) {
    cached.lastUsed = Date.now()
    return cached.db
  }
  ensureSessionsDir()
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.sqlite`)
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  sqliteVec.load(db)
  cache.set(sessionId, { db, lastUsed: Date.now() })
  evictIfNeeded()
  return db
}

export function getLocalSessionDb(sessionId: string): Database.Database {
  return openSession(sessionId)
}

export function getLocalSessionsDir(): string {
  return SESSIONS_DIR
}

export function closeAllLocalSessions(): void {
  for (const [, e] of cache) e.db.close()
  cache.clear()
}

export interface CreateLocalDriverOptions {
  openaiApiKey?: string
  anthropicApiKey?: string
  embeddingModel?: string
  extractionModel?: string
  similarityThreshold?: number
  recallLimit?: number
  searchLimit?: number
}

/**
 * Compose the `local` MemoryDriver from the reference stage implementations.
 *
 * Per-session SQLite isolation is preserved (one db file per sessionId, sqlite-vec
 * loaded on open); the store resolves the right db on every call via `getDb`.
 */
export function createLocalDriver(
  opts: CreateLocalDriverOptions = {},
): MemoryDriver {
  // Keys are passed through to the SDK constructors and only exercised on
  // the first API call. Registration is therefore safe even if a key is
  // missing — the driver will surface a clear error on the first retain/recall.
  const openaiApiKey = opts.openaiApiKey ?? process.env.OPENAI_API_KEY ?? ''
  const anthropicApiKey =
    opts.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? ''

  const embedder = createOpenAIEmbedder({
    apiKey: openaiApiKey,
    model: opts.embeddingModel,
  })

  const store = createSqliteFactStore({
    getDb: (scope: Scope) => getLocalSessionDb(scope.sessionId),
    embedder,
    similarityThreshold: opts.similarityThreshold ?? 0.75,
  })

  const extractor = createAnthropicExtractor({
    apiKey: anthropicApiKey,
    model: opts.extractionModel,
  })

  const consolidator = createSimpleConsolidator({
    apiKey: anthropicApiKey,
    model: opts.extractionModel,
    searchLimit: opts.searchLimit ?? 5,
    similarityThreshold: opts.similarityThreshold ?? 0.75,
  })

  return createComposedDriver({
    id: 'local',
    store,
    extractor,
    consolidator,
    renderer: createBulletRenderer({ idPrefix: 'local' }),
    recallLimit: opts.recallLimit ?? 8,
  })
}
