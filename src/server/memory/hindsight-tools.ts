import { z } from 'zod'
import type { Tool } from '@tanstack/ai'
import { recallResponseToPromptString } from '@vectorize-io/hindsight-client'

import type {
  RecallFragment,
  RecallResult,
  Scope,
} from '#/lib/memory/types'

import { bankIdFor, client, safeCall } from './hindsight'
import { pushToolRecall, pushToolRetain } from './tool-event-buffer'

export function makeHindsightTools(scope: Scope): Array<Tool> {
  const bankId = bankIdFor(scope)
  const sessionId = scope.sessionId

  const retainTool: Tool = {
    name: 'hindsight_retain',
    description:
      'Explicitly store a fact, decision, or piece of context to remember in future sessions. Call this when the user shares something important about themselves, their preferences, their work, or any detail that should persist beyond this conversation.',
    inputSchema: z.object({
      content: z
        .string()
        .describe(
          'The exact fact, decision, or piece of context to store. Write it as a self-contained statement that will still make sense out of conversation context.',
        ),
    }),
    async execute(args: { content: string }) {
      const ts = new Date()
      const res = await safeCall(() =>
        client.retain(bankId, args.content, {
          context: 'chat:tool',
          timestamp: ts,
        }),
      )
      pushToolRetain(sessionId, {
        engine: 'hindsight',
        receipt: {
          engine: 'hindsight',
          ok: res.ok,
          latencyMs: res.latencyMs,
          raw: res.ok ? res.data : null,
          error: res.ok ? undefined : res.error,
        },
      })
      return res.ok
        ? { ok: true }
        : { ok: false, error: res.error }
    },
  }

  const recallTool: Tool = {
    name: 'hindsight_recall',
    description:
      'Query memory directly with a specific question. Use this when you need context that may not have surfaced in the automatic recall — for example, to look up a different topic than the user\'s last message, or to find facts about an entity mentioned in passing.',
    inputSchema: z.object({
      query: z
        .string()
        .describe('Natural-language question or topic to look up.'),
    }),
    async execute(args: { query: string }) {
      const res = await safeCall(() =>
        client.recall(bankId, args.query, { budget: 'mid' }),
      )
      if (!res.ok) {
        const failed: RecallResult = {
          engine: 'hindsight',
          latencyMs: res.latencyMs,
          systemPrompt: '',
          fragments: [],
          tools: [],
          toolGuidance: '',
          raw: { error: res.error },
        }
        pushToolRecall(sessionId, {
          engine: 'hindsight',
          query: args.query,
          result: failed,
        })
        return `(no memory available: ${res.error})`
      }
      const systemPrompt = recallResponseToPromptString(res.data)
      const results = res.data.results ?? []
      const fragments: Array<RecallFragment> = results.map((r) => ({
        text: r.text,
        source: r.type ?? r.id,
      }))
      pushToolRecall(sessionId, {
        engine: 'hindsight',
        query: args.query,
        result: {
          engine: 'hindsight',
          latencyMs: res.latencyMs,
          systemPrompt,
          fragments,
          tools: [],
          toolGuidance: '',
          raw: res.data,
        },
      })
      return systemPrompt || '(no relevant memories found)'
    },
  }

  const reflectTool: Tool = {
    name: 'hindsight_reflect',
    description:
      'Synthesize across many memories to answer questions that require reasoning over accumulated knowledge, rather than retrieving specific facts. Use this for questions like "what do I know about this user\'s stack?" or "what has the user been working on lately?"',
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'The synthesis question to reflect on, e.g. "what do I know about the user\'s preferences?"',
        ),
    }),
    async execute(args: { query: string }) {
      const res = await safeCall(() => client.reflect(bankId, args.query))
      if (!res.ok) {
        return `(reflection failed: ${res.error})`
      }
      const text = (res.data as { text?: string }).text
      return text ?? '(no reflection)'
    },
  }

  return [retainTool, recallTool, reflectTool]
}
