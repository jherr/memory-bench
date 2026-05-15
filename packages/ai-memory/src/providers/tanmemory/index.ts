import { eq, isNull } from 'drizzle-orm'

import { getRawSessionDb, getSessionDb } from './session-db'
import { tanmemoryMemories } from './session-db/schema'
import type {
  FactList,
  MemoryDriver,
  MemoryFact,
  MemorySnapshot,
  RecallResult,
  RetainInput,
  RetainReceipt,
  Scope,
} from '../../index'

import { makeTanmemoryTools } from './tools'
import {
  decideConsolidation,
  extractFacts,
  type Neighbor,
} from './consolidate'
import {
  embed,
  embedMany,
  l2DistanceToSimilarity,
  toVecBuffer,
} from './embeddings'

const KNN_K_RETAIN = 5
const KNN_K_RECALL = 8
const MERGE_SIM_GATE = 0.75

const TANMEMORY_TOOL_GUIDANCE = `You have access to persistent long-term memory that survives across sessions.

Relevant memories for this turn have already been recalled and included in
your context. You also have three tools for direct control over memory:

- tanmemory_retain(content): explicitly store a fact, decision, or piece of
  context you want to ensure is remembered in future sessions. Call this when
  the user shares something important about themselves, their preferences,
  their work, or any detail that should persist beyond this conversation.

- tanmemory_recall(query): query memory directly with a specific question.
  Use this when you need context that may not have surfaced in the automatic
  recall — for example, to look up a different topic than the user's last
  message, or to find facts about an entity mentioned in passing.

- tanmemory_reflect(question): synthesize across many memories to answer
  questions that require reasoning over accumulated knowledge, rather than
  retrieving specific facts. Use this for questions like "what do I know
  about this user's stack?" or "what has the user been working on lately?"

Prefer to use these tools when they would meaningfully improve your response.
You do not need to call them on every turn.`

interface Knn {
  memory_id: number
  distance: number
}

interface ActiveMemory {
  id: number
  content: string
}

function knnSearch(
  sessionId: string,
  queryVec: Float32Array,
  k: number,
): Array<Knn> {
  const raw = getRawSessionDb(sessionId)
  const stmt = raw.prepare(
    `SELECT memory_id, distance
     FROM tanmemory_vec
     WHERE embedding MATCH ?
     ORDER BY distance
     LIMIT ?`,
  )
  return stmt.all(toVecBuffer(queryVec), BigInt(k)) as Array<Knn>
}

function loadActiveMemories(
  sessionId: string,
  ids: Array<number>,
): Map<number, string> {
  if (ids.length === 0) return new Map()
  const db = getSessionDb(sessionId)
  const rows = db
    .select({
      id: tanmemoryMemories.id,
      content: tanmemoryMemories.content,
      supersededBy: tanmemoryMemories.supersededBy,
    })
    .from(tanmemoryMemories)
    .all()
  const allowed = new Set(ids)
  const map = new Map<number, string>()
  for (const r of rows) {
    if (!allowed.has(r.id)) continue
    if (r.supersededBy !== null) continue
    map.set(r.id, r.content)
  }
  return map
}

function listActiveMemories(sessionId: string): Array<ActiveMemory> {
  const db = getSessionDb(sessionId)
  return db
    .select({
      id: tanmemoryMemories.id,
      content: tanmemoryMemories.content,
    })
    .from(tanmemoryMemories)
    .where(isNull(tanmemoryMemories.supersededBy))
    .all()
}

interface NeighborSearch {
  neighbors: Array<Neighbor>
  bestSimilarity: number
}

async function findNeighbors(
  sessionId: string,
  vec: Float32Array,
  k: number,
): Promise<NeighborSearch> {
  const hits = knnSearch(sessionId, vec, k)
  if (hits.length === 0) return { neighbors: [], bestSimilarity: 0 }
  const ids = hits.map((h) => h.memory_id)
  const contentMap = loadActiveMemories(sessionId, ids)
  const neighbors: Array<Neighbor> = []
  for (const h of hits) {
    const content = contentMap.get(h.memory_id)
    if (!content) continue // skip superseded
    neighbors.push({
      id: h.memory_id,
      content,
      similarity: l2DistanceToSimilarity(h.distance),
    })
  }
  const bestSimilarity = neighbors.length === 0 ? 0 : neighbors[0].similarity
  return { neighbors, bestSimilarity }
}

interface InsertResult {
  action: 'insert' | 'merge' | 'skip'
  newId?: number
  mergedInto?: number
}

async function insertFact(
  sessionId: string,
  content: string,
  vec: Float32Array,
  source: 'middleware' | 'tool' | 'consolidation',
): Promise<number> {
  const drz = getSessionDb(sessionId)
  const inserted = drz
    .insert(tanmemoryMemories)
    .values({ content, source })
    .returning({ id: tanmemoryMemories.id })
    .all()
  const newId = inserted[0].id
  const raw = getRawSessionDb(sessionId)
  raw
    .prepare(
      `INSERT INTO tanmemory_vec(memory_id, embedding) VALUES (?, ?)`,
    )
    .run(BigInt(newId), toVecBuffer(vec))
  return newId
}

async function applyConsolidation(
  sessionId: string,
  fact: string,
  vec: Float32Array,
  neighbors: Array<Neighbor>,
  defaultSource: 'middleware' | 'tool',
): Promise<InsertResult> {
  if (neighbors.length === 0 || neighbors[0].similarity < MERGE_SIM_GATE) {
    const newId = await insertFact(sessionId, fact, vec, defaultSource)
    return { action: 'insert', newId }
  }
  const decision = await decideConsolidation(fact, neighbors)
  if (decision.action === 'skip') {
    return { action: 'skip' }
  }
  if (decision.action === 'insert') {
    const newId = await insertFact(sessionId, fact, vec, defaultSource)
    return { action: 'insert', newId }
  }
  // merge: insert new fact, mark old as superseded
  const mergedVec = await embed(decision.newText)
  const newId = await insertFact(
    sessionId,
    decision.newText,
    mergedVec,
    'consolidation',
  )
  const drz = getSessionDb(sessionId)
  drz
    .update(tanmemoryMemories)
    .set({ supersededBy: newId, updatedAt: new Date().toISOString() })
    .where(eq(tanmemoryMemories.id, decision.intoId))
    .run()
  return { action: 'merge', newId, mergedInto: decision.intoId }
}

export async function retainSingleFact(
  scope: Scope,
  fact: string,
  source: 'middleware' | 'tool',
): Promise<InsertResult> {
  const vec = await embed(fact)
  const { neighbors } = await findNeighbors(scope.sessionId, vec, KNN_K_RETAIN)
  return applyConsolidation(scope.sessionId, fact, vec, neighbors, source)
}

export async function recallRendered(
  scope: Scope,
  query: string,
  k: number,
): Promise<{
  latencyMs: number
  items: Array<{ id: number; content: string; similarity: number }>
}> {
  const start = Date.now()
  const vec = await embed(query)
  const hits = knnSearch(scope.sessionId, vec, k)
  if (hits.length === 0) {
    return { latencyMs: Date.now() - start, items: [] }
  }
  const ids = hits.map((h) => h.memory_id)
  const contentMap = loadActiveMemories(scope.sessionId, ids)
  const items: Array<{ id: number; content: string; similarity: number }> = []
  for (const h of hits) {
    const content = contentMap.get(h.memory_id)
    if (!content) continue
    items.push({
      id: h.memory_id,
      content,
      similarity: l2DistanceToSimilarity(h.distance),
    })
  }
  return { latencyMs: Date.now() - start, items }
}

function renderSystemPrompt(
  items: Array<{ content: string; id: number }>,
): string {
  if (items.length === 0) return ''
  return `Recalled memory:\n${items
    .map((i) => `- (tanmemory#${i.id}) ${i.content}`)
    .join('\n')}`
}

export { renderSystemPrompt, TANMEMORY_TOOL_GUIDANCE, listActiveMemories }

export const tanmemoryEngine: MemoryDriver = {
  id: 'tanmemory',

  async retainTurn(scope: Scope, input: RetainInput): Promise<Array<RetainReceipt>> {
    const start = Date.now()
    try {
      const facts = await extractFacts({
        user: input.user,
        assistant: input.assistant,
      })
      if (facts.length === 0) {
        return [
          {
            engine: 'tanmemory',
            ok: true,
            latencyMs: Date.now() - start,
            raw: { facts: 0, applied: [] },
          },
        ]
      }
      const vecs = await embedMany(facts)
      const applied: Array<InsertResult & { fact: string }> = []
      for (let i = 0; i < facts.length; i++) {
        const fact = facts[i]
        const vec = vecs[i]
        const { neighbors } = await findNeighbors(
          scope.sessionId,
          vec,
          KNN_K_RETAIN,
        )
        const result = await applyConsolidation(
          scope.sessionId,
          fact,
          vec,
          neighbors,
          'middleware',
        )
        applied.push({ ...result, fact })
      }
      return [
        {
          engine: 'tanmemory',
          ok: true,
          latencyMs: Date.now() - start,
          raw: { facts: facts.length, applied },
        },
      ]
    } catch (err: any) {
      return [
        {
          engine: 'tanmemory',
          ok: false,
          latencyMs: Date.now() - start,
          raw: null,
          error: err?.message ?? String(err),
        },
      ]
    }
  },

  async recall(scope: Scope, query: string): Promise<RecallResult> {
    const tools = makeTanmemoryTools(scope)
    try {
      const { latencyMs, items } = await recallRendered(scope, query, KNN_K_RECALL)
      const fragments = items.map((i) => ({
        text: i.content,
        source: `tanmemory#${i.id}`,
      }))
      return {
        engine: 'tanmemory',
        latencyMs,
        systemPrompt: renderSystemPrompt(items),
        fragments,
        tools,
        toolGuidance: TANMEMORY_TOOL_GUIDANCE,
        raw: { items },
      }
    } catch (err: any) {
      return {
        engine: 'tanmemory',
        latencyMs: 0,
        systemPrompt: '',
        fragments: [],
        tools,
        toolGuidance: TANMEMORY_TOOL_GUIDANCE,
        raw: { error: err?.message ?? String(err) },
      }
    }
  },

  async inspect(scope: Scope): Promise<MemorySnapshot> {
    const drz = getSessionDb(scope.sessionId)
    const rows = drz
      .select()
      .from(tanmemoryMemories)
      .all()
    const active = rows.filter((r) => r.supersededBy === null)
    const superseded = rows.filter((r) => r.supersededBy !== null)
    return {
      engine: 'tanmemory',
      takenAt: new Date().toISOString(),
      data: {
        memories: active.map((r) => ({
          id: r.id,
          content: r.content,
          source: r.source,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        supersededCount: superseded.length,
        supersededChains: superseded.map((r) => ({
          id: r.id,
          content: r.content,
          supersededBy: r.supersededBy,
        })),
      },
    }
  },

  async listFacts(scope: Scope): Promise<FactList> {
    const drz = getSessionDb(scope.sessionId)
    const rows = drz
      .select()
      .from(tanmemoryMemories)
      .where(isNull(tanmemoryMemories.supersededBy))
      .all()
    const facts: Array<MemoryFact> = rows.map((r) => ({
      id: `tanmemory-${r.id}`,
      text: r.content,
      source: r.source,
      createdAt: r.createdAt,
    }))
    return {
      engine: 'tanmemory',
      facts,
      takenAt: new Date().toISOString(),
    }
  },
}

export { makeTanmemoryTools } from './tools'

export { getSessionDb as getTanmemorySessionDb, getSessionsDir as getTanmemorySessionsDir } from './session-db'
export { tanmemoryMemories } from './session-db/schema'
