import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { Tool } from '@tanstack/ai'

import type { RecallResult, Scope } from '../../index'

import {
  recallRendered,
  renderSystemPrompt,
  retainSingleFact,
} from './index'

const MODEL_EXTRACTION = process.env.MODEL_EXTRACTION ?? 'claude-haiku-4-5'
const REFLECT_K = 20

let _anthropic: Anthropic | null = null
function anthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _anthropic
}

export function makeTanmemoryTools(scope: Scope): Array<Tool> {
  const retainTool: Tool = {
    name: 'tanmemory_retain',
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
      const start = Date.now()
      try {
        const result = await retainSingleFact(scope, args.content, 'tool')
        const latencyMs = Date.now() - start
        scope.toolEvents?.onToolRetain?.({
          engine: 'tanmemory',
          receipt: {
            engine: 'tanmemory',
            ok: true,
            latencyMs,
            raw: result,
          },
        })
        return { ok: true, action: result.action }
      } catch (err: any) {
        const latencyMs = Date.now() - start
        scope.toolEvents?.onToolRetain?.({
          engine: 'tanmemory',
          receipt: {
            engine: 'tanmemory',
            ok: false,
            latencyMs,
            raw: null,
            error: err?.message ?? String(err),
          },
        })
        return { ok: false, error: err?.message ?? String(err) }
      }
    },
  }

  const recallTool: Tool = {
    name: 'tanmemory_recall',
    description:
      'Query memory directly with a specific question. Use this when you need context that may not have surfaced in the automatic recall — for example, to look up a different topic than the user\'s last message, or to find facts about an entity mentioned in passing.',
    inputSchema: z.object({
      query: z.string().describe('Natural-language question or topic to look up.'),
    }),
    async execute(args: { query: string }) {
      try {
        const { latencyMs, items } = await recallRendered(scope, args.query, 8)
        const systemPrompt = renderSystemPrompt(items)
        const fragments = items.map((i) => ({
          text: i.content,
          source: `tanmemory#${i.id}`,
        }))
        const result: RecallResult = {
          engine: 'tanmemory',
          latencyMs,
          systemPrompt,
          fragments,
          tools: [],
          toolGuidance: '',
          raw: { items },
        }
        scope.toolEvents?.onToolRecall?.({
          engine: 'tanmemory',
          query: args.query,
          result,
        })
        return systemPrompt || '(no relevant memories found)'
      } catch (err: any) {
        return `(recall failed: ${err?.message ?? String(err)})`
      }
    },
  }

  const reflectTool: Tool = {
    name: 'tanmemory_reflect',
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
      try {
        const { items } = await recallRendered(scope, args.query, REFLECT_K)
        if (items.length === 0) {
          return "(I don't have memories about that yet.)"
        }
        const memoryBlock = items
          .map((i, idx) => `${idx + 1}. ${i.content}`)
          .join('\n')
        const res = await anthropic().messages.create({
          model: MODEL_EXTRACTION,
          max_tokens: 1024,
          system:
            'You synthesize accumulated memories to answer questions. Be concise and concrete. Cite memories by their numeric index when useful. If the memories do not actually answer the question, say so plainly.',
          messages: [
            {
              role: 'user',
              content: `Memories:\n${memoryBlock}\n\nQuestion: ${args.query}\n\nSynthesize a focused answer in a short paragraph.`,
            },
          ],
        })
        const text = res.content
          .filter(
            (c): c is Anthropic.TextBlock => c.type === 'text',
          )
          .map((c) => c.text)
          .join('\n')
          .trim()
        return text || '(no synthesis produced)'
      } catch (err: any) {
        return `(reflection failed: ${err?.message ?? String(err)})`
      }
    },
  }

  return [retainTool, recallTool, reflectTool]
}
