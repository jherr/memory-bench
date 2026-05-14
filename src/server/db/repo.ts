import { and, asc, eq } from 'drizzle-orm'

import { getSessionDb } from './sessionDb'
import { recalls, retains, sessionMeta, snapshots, turns } from './schema'
import type {
  EngineId,
  MemorySnapshot,
  RecallResult,
  RetainReceipt,
} from '#/lib/memory/types'

export type SessionMode = 'explorer' | 'scientist'

export function ensureSessionMeta(
  sessionId: string,
  defaults: {
    mode: SessionMode
    modelChat: string
    modelExtraction: string
    activeEngineLocked?: EngineId | null
  },
) {
  const db = getSessionDb(sessionId)
  const existing = db.select().from(sessionMeta).limit(1).all()
  if (existing.length > 0) return existing[0]
  const inserted = db
    .insert(sessionMeta)
    .values({
      mode: defaults.mode,
      modelChat: defaults.modelChat,
      modelExtraction: defaults.modelExtraction,
      activeEngineLocked: defaults.activeEngineLocked ?? null,
    })
    .returning()
    .all()
  return inserted[0]
}

export function getSessionMeta(sessionId: string) {
  const db = getSessionDb(sessionId)
  const row = db.select().from(sessionMeta).limit(1).all()
  return row[0] ?? null
}

export function insertTurn(
  sessionId: string,
  args: { userContent: string; assistantContent: string; activeEngine: EngineId },
): number {
  const db = getSessionDb(sessionId)
  const row = db
    .insert(turns)
    .values({
      userContent: args.userContent,
      assistantContent: args.assistantContent,
      activeEngine: args.activeEngine,
    })
    .returning({ id: turns.id })
    .all()
  return row[0].id
}

export type RetainSource = 'middleware' | 'tool'

export function insertRetains(
  sessionId: string,
  turnId: number,
  receipts: Array<RetainReceipt>,
  opts: { source?: RetainSource } = {},
) {
  if (receipts.length === 0) return
  const source = opts.source ?? 'middleware'
  const db = getSessionDb(sessionId)
  db.insert(retains)
    .values(
      receipts.map((r) => ({
        turnId,
        engine: r.engine,
        ok: r.ok,
        latencyMs: r.latencyMs,
        rawJson: JSON.stringify(r.raw ?? null),
        error: r.error ?? null,
        source,
      })),
    )
    .run()
}

export function insertRecall(
  sessionId: string,
  turnId: number,
  result: RecallResult,
  query: string,
  opts: { source?: RetainSource } = {},
) {
  const source = opts.source ?? 'middleware'
  const db = getSessionDb(sessionId)
  db.insert(recalls)
    .values({
      turnId,
      engine: result.engine,
      query,
      latencyMs: result.latencyMs,
      fragmentsJson: JSON.stringify(result.fragments ?? []),
      rawJson: JSON.stringify(result.raw ?? null),
      source,
    })
    .run()
}

export function insertSnapshots(
  sessionId: string,
  turnId: number,
  kind: 'pre' | 'post',
  snaps: Array<MemorySnapshot>,
) {
  if (snaps.length === 0) return
  const db = getSessionDb(sessionId)
  db.insert(snapshots)
    .values(
      snaps.map((s) => ({
        turnId,
        engine: s.engine,
        kind,
        dataJson: JSON.stringify(s.data ?? null),
      })),
    )
    .run()
}

export function getTurns(sessionId: string) {
  const db = getSessionDb(sessionId)
  return db.select().from(turns).orderBy(asc(turns.id)).all()
}

export function getSnapshotsAtTurn(
  sessionId: string,
  turnId: number,
  kind: 'pre' | 'post',
) {
  const db = getSessionDb(sessionId)
  return db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.turnId, turnId), eq(snapshots.kind, kind)))
    .all()
}

export function getTimelineRows(sessionId: string) {
  const db = getSessionDb(sessionId)
  const allTurns = db.select().from(turns).orderBy(asc(turns.id)).all()
  const allRetains = db.select().from(retains).all()
  const byTurn = new Map<number, Array<typeof allRetains[number]>>()
  for (const r of allRetains) {
    const list = byTurn.get(r.turnId) ?? []
    list.push(r)
    byTurn.set(r.turnId, list)
  }
  return allTurns.map((t) => ({
    turnId: t.id,
    ts: t.ts,
    activeEngine: t.activeEngine as EngineId,
    perEngine: (byTurn.get(t.id) ?? []).map((r) => ({
      engine: r.engine as EngineId,
      ok: r.ok,
      latencyMs: r.latencyMs,
      error: r.error,
      source: (r.source as RetainSource | null) ?? null,
    })),
  }))
}
