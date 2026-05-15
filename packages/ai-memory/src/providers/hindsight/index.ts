import {
  HindsightClient,
  recallResponseToPromptString,
} from '@vectorize-io/hindsight-client'

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

import { makeHindsightTools } from './tools'

const HINDSIGHT_URL = process.env.HINDSIGHT_URL ?? 'http://localhost:8888'

export const client = new HindsightClient({ baseUrl: HINDSIGHT_URL })

const HINDSIGHT_TOOL_GUIDANCE = `You have access to persistent long-term memory that survives across sessions.

Relevant memories for this turn have already been recalled and included in
your context. You also have three tools for direct control over memory:

- hindsight_retain(content): explicitly store a fact, decision, or piece of
  context you want to ensure is remembered in future sessions. Call this when
  the user shares something important about themselves, their preferences,
  their work, or any detail that should persist beyond this conversation.

- hindsight_recall(query): query memory directly with a specific question.
  Use this when you need context that may not have surfaced in the automatic
  recall — for example, to look up a different topic than the user's last
  message, or to find facts about an entity mentioned in passing.

- hindsight_reflect(question): synthesize across many memories to answer
  questions that require reasoning over accumulated knowledge, rather than
  retrieving specific facts. Use this for questions like "what do I know
  about this user's stack?" or "what has the user been working on lately?"

Prefer to use these tools when they would meaningfully improve your response.
You do not need to call them on every turn.`

export async function resetHindsightBank(
  userId: string,
  sessionId: string,
): Promise<void> {
  await client.deleteBank(`${userId}__${sessionId}`)
}

/**
 * Hindsight bank id: `{userId}__{sessionId}`.
 * Session-bucketed so each conversation gets an isolated bank, unlike mem0 user_id
 * or Honcho's durable peer.
 */
export function bankIdFor(scope: Scope): string {
  const userId = scope.userId ?? 'demo-user'
  return `${userId}__${scope.sessionId}`
}

/**
 * Hindsight extraction can yield multiple memory units per retain call. The
 * `world` / `experience` facts preserve the retain `context` (e.g. "chat:user"),
 * but `observation` units come back with `context: ""` because they're derived
 * statements about the conversation, not direct quotes from a participant.
 *
 * Resolution order:
 *  - Non-empty `context` → mapped to "middleware" / "tool" (or the raw context
 *    string for any custom value).
 *  - Empty/missing `context` → fall back to Hindsight's `fact_type`
 *    (`observation` / `world` / `experience`), which is still meaningful
 *    provenance. Legacy `type` is checked too in case the API renames.
 *  - Only return "unknown" when neither field is present.
 */
function hindsightListFactSource(m: Record<string, unknown>): string {
  const ctxRaw = m.context
  const ctx =
    typeof ctxRaw === 'string' && ctxRaw.length > 0 ? ctxRaw : undefined
  if (ctx === 'chat:tool') return 'tool'
  if (ctx === 'chat:user' || ctx === 'chat:assistant') return 'middleware'
  if (ctx) return ctx

  const factType = m.fact_type
  if (typeof factType === 'string' && factType.length > 0) return factType

  const t = m.type
  if (typeof t === 'string' && t.length > 0) return t

  return 'unknown'
}

export async function safeCall<T>(
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

export const hindsightEngine: MemoryDriver = {
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
    const tools = makeHindsightTools(scope)
    const res = await safeCall(() =>
      client.recall(bankId, query, { budget: 'mid' }),
    )
    if (!res.ok) {
      return {
        engine: 'hindsight',
        latencyMs: res.latencyMs,
        systemPrompt: '',
        fragments: [],
        tools,
        toolGuidance: HINDSIGHT_TOOL_GUIDANCE,
        raw: { error: res.error },
      }
    }
    const results = res.data.results ?? []
    return {
      engine: 'hindsight',
      latencyMs: res.latencyMs,
      systemPrompt: recallResponseToPromptString(res.data),
      fragments: results.map((r) => ({
        text: r.text,
        source: r.type ?? r.id,
      })),
      tools,
      toolGuidance: HINDSIGHT_TOOL_GUIDANCE,
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
    const facts = items
      .map((m, i): MemoryFact | null => {
        const text =
          (m.text as string | undefined) ??
          (m.content as string | undefined) ??
          ''
        if (!text) return null
        return {
          id: (m.id as string | undefined) ?? `hindsight-${i}`,
          text,
          source: hindsightListFactSource(m),
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

export { makeHindsightTools } from './tools'
