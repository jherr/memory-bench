import type {
  MemoryEngine,
  MemorySnapshot,
  RecallResult,
  RetainInput,
  RetainReceipt,
  Scope,
} from '#/lib/memory/types'

const MEM0_URL = process.env.MEM0_URL ?? 'http://localhost:8000'
const MEM0_API_KEY = process.env.MEM0_ADMIN_API_KEY ?? ''

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (MEM0_API_KEY) h.Authorization = `Bearer ${MEM0_API_KEY}`
  return h
}

function userIdFor(scope: Scope): string {
  return scope.userId ?? 'demo-user'
}

async function safeJson(
  fn: () => Promise<Response>,
): Promise<
  | { ok: true; latencyMs: number; data: any }
  | { ok: false; latencyMs: number; error: string }
> {
  const start = Date.now()
  try {
    const res = await fn()
    const latencyMs = Date.now() - start
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, latencyMs, error: `HTTP ${res.status}: ${text.slice(0, 300)}` }
    }
    const data = await res.json().catch(() => null)
    return { ok: true, latencyMs, data }
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err?.message ?? String(err),
    }
  }
}

export const mem0Engine: MemoryEngine = {
  id: 'mem0',

  async retainTurn(scope, input: RetainInput): Promise<Array<RetainReceipt>> {
    const result = await safeJson(() =>
      fetch(`${MEM0_URL}/memories`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          messages: [
            { role: 'user', content: input.user },
            { role: 'assistant', content: input.assistant },
          ],
          user_id: userIdFor(scope),
          run_id: scope.sessionId,
        }),
      }),
    )
    return [
      {
        engine: 'mem0',
        ok: result.ok,
        latencyMs: result.latencyMs,
        raw: result.ok ? result.data : null,
        error: result.ok ? undefined : result.error,
      },
    ]
  },

  async recall(scope, query): Promise<RecallResult> {
    const result = await safeJson(() =>
      fetch(`${MEM0_URL}/search`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          query,
          user_id: userIdFor(scope),
          run_id: scope.sessionId,
        }),
      }),
    )
    if (!result.ok) {
      return {
        engine: 'mem0',
        latencyMs: result.latencyMs,
        fragments: [],
        raw: { error: result.error },
      }
    }
    const items: Array<any> = result.data?.results ?? result.data ?? []
    return {
      engine: 'mem0',
      latencyMs: result.latencyMs,
      fragments: items.map((m: any) => ({
        text: m.memory ?? m.text ?? JSON.stringify(m),
        source: m.id ?? 'mem0',
      })),
      raw: result.data,
    }
  },

  async inspect(scope): Promise<MemorySnapshot> {
    const userId = userIdFor(scope)
    const url = `${MEM0_URL}/memories?user_id=${encodeURIComponent(userId)}&run_id=${encodeURIComponent(scope.sessionId)}`
    const result = await safeJson(() =>
      fetch(url, { method: 'GET', headers: authHeaders() }),
    )
    return {
      engine: 'mem0',
      takenAt: new Date().toISOString(),
      data: result.ok ? result.data : { error: result.error },
    }
  },
}
