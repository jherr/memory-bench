import type {
  FactList,
  MemoryDriver,
  MemoryFact,
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

export async function resetMem0User(userId: string): Promise<void> {
  const bulkUrl = `${MEM0_URL}/memories?user_id=${encodeURIComponent(userId)}`
  const bulkRes = await fetch(bulkUrl, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (bulkRes.ok) return
  const listRes = await fetch(bulkUrl, { method: 'GET', headers: authHeaders() })
  if (!listRes.ok) {
    throw new Error(`mem0 bulk delete failed (${bulkRes.status}) and list failed (${listRes.status})`)
  }
  const json: any = await listRes.json().catch(() => null)
  const items: Array<any> = Array.isArray(json?.results)
    ? json.results
    : Array.isArray(json)
      ? json
      : []
  await Promise.all(
    items
      .map((m) => m?.id as string | undefined)
      .filter((id): id is string => !!id)
      .map((id) =>
        fetch(`${MEM0_URL}/memories/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: authHeaders(),
        }),
      ),
  )
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

export const mem0Engine: MemoryDriver = {
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
          rerank: true,
          threshold: 0.1,
        }),
      }),
    )
    if (!result.ok) {
      return {
        engine: 'mem0',
        latencyMs: result.latencyMs,
        systemPrompt: '',
        fragments: [],
        tools: [],
        toolGuidance: '',
        raw: { error: result.error },
      }
    }
    const items: Array<any> = result.data?.results ?? result.data ?? []
    const fragments = items.map((m: any) => ({
      text: m.memory ?? m.text ?? JSON.stringify(m),
      source: m.id ?? 'mem0',
    }))
    const systemPrompt =
      fragments.length === 0
        ? ''
        : `Recalled memory:\n${fragments
            .map((f) => `- (${f.source}) ${f.text}`)
            .join('\n')}`
    return {
      engine: 'mem0',
      latencyMs: result.latencyMs,
      systemPrompt,
      fragments,
      tools: [],
      toolGuidance: '',
      raw: result.data,
    }
  },

  async inspect(scope): Promise<MemorySnapshot> {
    const userId = userIdFor(scope)
    const url = `${MEM0_URL}/memories?user_id=${encodeURIComponent(userId)}`
    const result = await safeJson(() =>
      fetch(url, { method: 'GET', headers: authHeaders() }),
    )
    return {
      engine: 'mem0',
      takenAt: new Date().toISOString(),
      data: result.ok ? result.data : { error: result.error },
    }
  },

  async listFacts(scope): Promise<FactList> {
    const userId = userIdFor(scope)
    const url = `${MEM0_URL}/memories?user_id=${encodeURIComponent(userId)}`
    const result = await safeJson(() =>
      fetch(url, { method: 'GET', headers: authHeaders() }),
    )
    if (!result.ok) {
      return { engine: 'mem0', facts: [], takenAt: new Date().toISOString() }
    }
    const items: Array<any> = Array.isArray(result.data?.results)
      ? result.data.results
      : Array.isArray(result.data)
        ? result.data
        : []
    const facts: Array<MemoryFact> = items
      .map((m, i) => {
        const text = (m?.memory as string | undefined) ?? ''
        if (!text) return null
        return {
          id: (m?.id as string | undefined) ?? `mem0-${i}`,
          text,
          source: 'memory',
          createdAt:
            (m?.updated_at as string | undefined) ??
            (m?.created_at as string | undefined) ??
            undefined,
        }
      })
      .filter((f): f is MemoryFact => f !== null)
    return { engine: 'mem0', facts, takenAt: new Date().toISOString() }
  },
}
