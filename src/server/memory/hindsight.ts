import { HindsightClient } from '@vectorize-io/hindsight-client'

import type {
  MemoryEngine,
  MemorySnapshot,
  RecallResult,
  RetainInput,
  RetainReceipt,
  Scope,
} from '#/lib/memory/types'

const HINDSIGHT_URL = process.env.HINDSIGHT_URL ?? 'http://localhost:8888'

const client = new HindsightClient({ baseUrl: HINDSIGHT_URL })

function bankIdFor(scope: Scope): string {
  const userId = scope.userId ?? 'demo-user'
  return `${userId}__${scope.sessionId}`
}

async function safeCall<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; latencyMs: number; data: T } | { ok: false; latencyMs: number; error: string }> {
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

export const hindsightEngine: MemoryEngine = {
  id: 'hindsight',

  async retainTurn(scope, input: RetainInput): Promise<Array<RetainReceipt>> {
    const bankId = bankIdFor(scope)
    const ts = new Date()
    const [userRes, asstRes] = await Promise.all([
      safeCall(() =>
        client.retain(bankId, input.user, {
          context: 'chat:user',
          timestamp: ts,
        }),
      ),
      safeCall(() =>
        client.retain(bankId, input.assistant, {
          context: 'chat:assistant',
          timestamp: ts,
        }),
      ),
    ])
    return [
      {
        engine: 'hindsight',
        ok: userRes.ok,
        latencyMs: userRes.latencyMs,
        raw: userRes.ok ? userRes.data : null,
        error: userRes.ok ? undefined : userRes.error,
      },
      {
        engine: 'hindsight',
        ok: asstRes.ok,
        latencyMs: asstRes.latencyMs,
        raw: asstRes.ok ? asstRes.data : null,
        error: asstRes.ok ? undefined : asstRes.error,
      },
    ]
  },

  async recall(scope, query): Promise<RecallResult> {
    const bankId = bankIdFor(scope)
    const res = await safeCall(() =>
      client.recall(bankId, query, { budget: 'mid' }),
    )
    if (!res.ok) {
      return {
        engine: 'hindsight',
        latencyMs: res.latencyMs,
        fragments: [],
        raw: { error: res.error },
      }
    }
    const results = res.data.results ?? []
    return {
      engine: 'hindsight',
      latencyMs: res.latencyMs,
      fragments: results.map((r) => ({
        text: r.text,
        source: r.type ?? r.id,
      })),
      raw: res.data,
    }
  },

  async inspect(scope): Promise<MemorySnapshot> {
    const bankId = bankIdFor(scope)
    const [memories, profile] = await Promise.all([
      safeCall(() => client.listMemories(bankId, { limit: 200 })),
      safeCall(() => client.getBankProfile(bankId)),
    ])
    return {
      engine: 'hindsight',
      takenAt: new Date().toISOString(),
      data: {
        memories: memories.ok ? memories.data : { error: memories.error },
        profile: profile.ok ? profile.data : { error: profile.error },
      },
    }
  },
}
