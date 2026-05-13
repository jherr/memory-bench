import { Honcho } from '@honcho-ai/sdk'
import type { Peer, Session } from '@honcho-ai/sdk'

import type {
  MemoryEngine,
  MemorySnapshot,
  RecallResult,
  RetainInput,
  RetainReceipt,
} from '#/lib/memory/types'

const HONCHO_URL = process.env.HONCHO_URL ?? 'http://localhost:8001'
const HONCHO_APP = process.env.HONCHO_APP_NAME ?? 'memory-bench'
const HONCHO_API_KEY = process.env.HONCHO_API_KEY ?? ''

const honcho = new Honcho({
  baseURL: HONCHO_URL,
  workspaceId: HONCHO_APP,
  apiKey: HONCHO_API_KEY || 'dev-no-auth',
})

const sessionCache = new Map<string, Promise<Session>>()
const userPeerCache = new Map<string, Promise<Peer>>()
let assistantPeerPromise: Promise<Peer> | null = null

function getUserPeer(userId: string): Promise<Peer> {
  let p = userPeerCache.get(userId)
  if (!p) {
    p = honcho.peer(userId)
    userPeerCache.set(userId, p)
  }
  return p
}

function getAssistantPeer(): Promise<Peer> {
  if (!assistantPeerPromise) assistantPeerPromise = honcho.peer('assistant')
  return assistantPeerPromise
}

function getSession(sessionId: string): Promise<Session> {
  let s = sessionCache.get(sessionId)
  if (!s) {
    s = honcho.session(sessionId)
    sessionCache.set(sessionId, s)
  }
  return s
}

async function timed<T>(
  fn: () => Promise<T>,
): Promise<
  | { ok: true; latencyMs: number; data: T }
  | { ok: false; latencyMs: number; error: string }
> {
  const start = Date.now()
  try {
    const data = await fn()
    return { ok: true, latencyMs: Date.now() - start, data }
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err?.message ?? String(err),
    }
  }
}

export const honchoEngine: MemoryEngine = {
  id: 'honcho',

  async retainTurn(scope, input: RetainInput): Promise<Array<RetainReceipt>> {
    const userId = scope.userId ?? 'demo-user'
    const result = await timed(async () => {
      const [userPeer, assistantPeer, session] = await Promise.all([
        getUserPeer(userId),
        getAssistantPeer(),
        getSession(scope.sessionId),
      ])
      return session.addMessages([
        userPeer.message(input.user),
        assistantPeer.message(input.assistant),
      ])
    })
    return [
      {
        engine: 'honcho',
        ok: result.ok,
        latencyMs: result.latencyMs,
        raw: result.ok ? result.data : null,
        error: result.ok ? undefined : result.error,
      },
    ]
  },

  async recall(scope, query): Promise<RecallResult> {
    const userId = scope.userId ?? 'demo-user'
    const result = await timed(async () => {
      const [userPeer, session] = await Promise.all([
        getUserPeer(userId),
        getSession(scope.sessionId),
      ])
      return userPeer.chat(query, { session })
    })
    if (!result.ok) {
      return {
        engine: 'honcho',
        latencyMs: result.latencyMs,
        fragments: [],
        raw: { error: result.error },
      }
    }
    const text = result.data
    return {
      engine: 'honcho',
      latencyMs: result.latencyMs,
      fragments: text
        ? [{ text, source: 'representation' }]
        : [],
      raw: { dialectic: text },
    }
  },

  async inspect(scope): Promise<MemorySnapshot> {
    const session = await getSession(scope.sessionId).catch(() => null)
    if (!session) {
      return {
        engine: 'honcho',
        takenAt: new Date().toISOString(),
        data: { error: 'failed to get session' },
      }
    }
    const [messages, queueStatus, summaries] = await Promise.all([
      timed(() => session.messages({ size: 50 })),
      timed(() => session.queueStatus()),
      timed(() => session.summaries()),
    ])
    return {
      engine: 'honcho',
      takenAt: new Date().toISOString(),
      data: {
        messages: messages.ok
          ? messages.data.items?.map((m: any) => ({
              id: m.id,
              peerId: m.peerId,
              content: m.content,
              createdAt: m.createdAt,
              metadata: m.metadata,
            })) ?? messages.data
          : { error: messages.error },
        queueStatus: queueStatus.ok ? queueStatus.data : { error: queueStatus.error },
        summaries: summaries.ok ? summaries.data : { error: summaries.error },
      },
    }
  },
}
