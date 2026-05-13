import { HindsightClient } from '@vectorize-io/hindsight-client'

import type {
  FactList,
  MemoryEngine,
  MemoryFact,
  MemorySnapshot,
  RecallResult,
  RetainInput,
  RetainReceipt,
  Scope,
} from '#/lib/memory/types'

const HINDSIGHT_URL = process.env.HINDSIGHT_URL ?? 'http://localhost:8888'

const client = new HindsightClient({ baseUrl: HINDSIGHT_URL })

export async function resetHindsightBank(
  userId: string,
  sessionId: string,
): Promise<void> {
  await client.deleteBank(`${userId}__${sessionId}`)
}

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

  async listFacts(scope): Promise<FactList> {
    const bankId = bankIdFor(scope)
    const res = await safeCall(() =>
      client.listMemories(bankId, { limit: 200 }),
    )
    if (!res.ok) {
      return { engine: 'hindsight', facts: [], takenAt: new Date().toISOString() }
    }
    const items = (res.data.items ?? []) as Array<Record<string, unknown>>
    const facts: Array<MemoryFact> = items
      .map((m, i) => {
        const text =
          (m.text as string | undefined) ??
          (m.content as string | undefined) ??
          ''
        if (!text) return null
        return {
          id: (m.id as string | undefined) ?? `hindsight-${i}`,
          text,
          source: (m.type as string | undefined) ?? 'memory',
          createdAt: (m.created_at as string | undefined) ?? undefined,
        }
      })
      .filter((f): f is MemoryFact => f !== null)
    return {
      engine: 'hindsight',
      facts,
      takenAt: new Date().toISOString(),
    }
  },
}
