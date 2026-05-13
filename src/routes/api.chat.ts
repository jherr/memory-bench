import { createFileRoute } from '@tanstack/react-router'
import { chat, toServerSentEventsResponse } from '@tanstack/ai'
import { anthropicText } from '@tanstack/ai-anthropic'

import { runRecallForTurn } from '#/server/memory/orchestrator'
import type { EngineId } from '#/lib/memory/types'

const MODEL_CHAT = (process.env.MODEL_CHAT ??
  'claude-sonnet-4-5') as Parameters<typeof anthropicText>[0]

const BASE_SYSTEM_PROMPT = `You are an experimental assistant inside a memory-bench harness.

You have access to memory that was recalled for this turn. Use it freely if it is relevant; do not mention the recall step itself. If the recalled memory is empty, answer normally without commenting on its absence.

Keep replies concise unless the user asks for depth.`

function buildSystemPrompt(fragments: Array<{ text: string; source: string }>) {
  if (fragments.length === 0) return BASE_SYSTEM_PROMPT
  const lines = fragments
    .map((f) => `- (${f.source}) ${f.text}`)
    .join('\n')
  return `${BASE_SYSTEM_PROMPT}\n\nRecalled memory:\n${lines}`
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestSignal = request.signal
        if (requestSignal.aborted) {
          return new Response(null, { status: 499 })
        }
        const abortController = new AbortController()

        try {
          const body = (await request.json()) as {
            messages: Array<{
              role: 'user' | 'assistant' | 'tool'
              content?: string
              parts?: Array<{ type: string; content?: string }>
            }>
            sessionId: string
            engineId: EngineId
          }
          const { messages, sessionId, engineId } = body

          const lastUser = [...messages]
            .reverse()
            .find((m) => m.role === 'user')
          const userText =
            (lastUser?.content as string | undefined) ??
            (Array.isArray(lastUser?.parts)
              ? lastUser!.parts
                  .filter((p: any) => p?.type === 'text')
                  .map((p: any) => p.content)
                  .join('\n')
              : '')

          let fragments: Array<{ text: string; source: string }> = []
          if (sessionId && engineId && userText) {
            const recall = await runRecallForTurn(sessionId, engineId, userText)
            fragments = recall.fragments
            ;(globalThis as any).__lastRecall = {
              sessionId,
              engineId,
              query: userText,
              result: recall,
            }
          }

          const adapter = anthropicText(MODEL_CHAT)

          const stream = chat({
            adapter,
            systemPrompts: [buildSystemPrompt(fragments)],
            messages: messages as any,
            abortController,
          })

          return toServerSentEventsResponse(stream, { abortController })
        } catch (error: any) {
          if (error.name === 'AbortError' || abortController.signal.aborted) {
            return new Response(null, { status: 499 })
          }
          console.error('[api/chat] error:', error)
          return new Response(
            JSON.stringify({ error: 'Failed to process chat request' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
