import { listEnabledEngines, getEngine } from './index'
import { drainToolEvents } from './tool-event-buffer'
import {
  ensureSessionMeta,
  insertRecall,
  insertRetains,
  insertSnapshots,
  insertTurn,
} from '#/server/db/repo'
import type {
  EngineId,
  MemorySnapshot,
  RecallResult,
  RetainReceipt,
} from '#/lib/memory/types'

const DEFAULT_POST_DELAY_MS = Number(process.env.SNAPSHOT_POST_DELAY_MS ?? 5000)
const HONCHO_POST_DELAY_MS = Number(
  process.env.SNAPSHOT_POST_DELAY_MS_HONCHO ?? 10000,
)
const MODEL_CHAT = process.env.MODEL_CHAT ?? 'claude-sonnet-4-5'
const MODEL_EXTRACTION = process.env.MODEL_EXTRACTION ?? 'claude-haiku-4-5'

const pendingPostSnapshots = new Map<string, NodeJS.Timeout>()

function postDelayFor(engineId: EngineId): number {
  return engineId === 'honcho' ? HONCHO_POST_DELAY_MS : DEFAULT_POST_DELAY_MS
}

export async function runRecallForTurn(
  sessionId: string,
  engineId: EngineId,
  query: string,
): Promise<RecallResult> {
  const engine = getEngine(engineId)
  return engine.recall({ sessionId }, query)
}

export async function runTurn(args: {
  sessionId: string
  userMsg: string
  assistantReply: string
  activeEngineId: EngineId
  recall?: { engineId: EngineId; result: RecallResult; query: string } | null
}): Promise<{
  turnId: number
  receipts: Array<RetainReceipt>
}> {
  const { sessionId, userMsg, assistantReply, activeEngineId, recall } = args

  ensureSessionMeta(sessionId, {
    mode: 'explorer',
    modelChat: MODEL_CHAT,
    modelExtraction: MODEL_EXTRACTION,
  })

  const turnId = insertTurn(sessionId, {
    userContent: userMsg,
    assistantContent: assistantReply,
    activeEngine: activeEngineId,
  })

  if (recall) {
    insertRecall(sessionId, turnId, recall.result, recall.query, {
      source: 'middleware',
    })
  }

  const toolEvents = drainToolEvents(sessionId)
  for (const ev of toolEvents.recalls) {
    insertRecall(sessionId, turnId, ev.result, ev.query, { source: 'tool' })
  }
  if (toolEvents.retains.length > 0) {
    insertRetains(
      sessionId,
      turnId,
      toolEvents.retains.map((e) => e.receipt),
      { source: 'tool' },
    )
  }

  const engines = listEnabledEngines()
  const settled = await Promise.allSettled(
    engines.map((e) =>
      e.retainTurn({ sessionId }, { user: userMsg, assistant: assistantReply }),
    ),
  )

  const receipts: Array<RetainReceipt> = []
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      receipts.push(...result.value)
    } else {
      receipts.push({
        engine: engines[i].id,
        ok: false,
        latencyMs: 0,
        raw: null,
        error: String(result.reason),
      })
    }
  })

  insertRetains(sessionId, turnId, receipts, { source: 'middleware' })

  void capturePreSnapshots(sessionId, turnId, engines.map((e) => e.id))
  schedulePostSnapshots(sessionId, turnId, engines.map((e) => e.id))

  return { turnId, receipts }
}

async function capturePreSnapshots(
  sessionId: string,
  turnId: number,
  engineIds: Array<EngineId>,
) {
  try {
    const snaps = await Promise.all(
      engineIds.map(async (id) => {
        try {
          return await getEngine(id).inspect({ sessionId })
        } catch (err: any) {
          return {
            engine: id,
            takenAt: new Date().toISOString(),
            data: { error: err?.message ?? String(err) },
          } as MemorySnapshot
        }
      }),
    )
    insertSnapshots(sessionId, turnId, 'pre', snaps)
  } catch (err) {
    console.error('[orchestrator] pre-snapshot failed:', err)
  }
}

function schedulePostSnapshots(
  sessionId: string,
  turnId: number,
  engineIds: Array<EngineId>,
) {
  const existing = pendingPostSnapshots.get(sessionId)
  if (existing) clearTimeout(existing)
  const longestDelay = Math.max(...engineIds.map((id) => postDelayFor(id)))
  const handle = setTimeout(async () => {
    pendingPostSnapshots.delete(sessionId)
    try {
      const snaps = await Promise.all(
        engineIds.map(async (id) => {
          try {
            return await getEngine(id).inspect({ sessionId })
          } catch (err: any) {
            return {
              engine: id,
              takenAt: new Date().toISOString(),
              data: { error: err?.message ?? String(err) },
            } as MemorySnapshot
          }
        }),
      )
      insertSnapshots(sessionId, turnId, 'post', snaps)
    } catch (err) {
      console.error('[orchestrator] post-snapshot failed:', err)
    }
  }, longestDelay)
  pendingPostSnapshots.set(sessionId, handle)
}
