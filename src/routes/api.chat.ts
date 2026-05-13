import { createFileRoute } from '@tanstack/react-router'
import { chat, toServerSentEventsResponse } from '@tanstack/ai'
import { anthropicText } from '@tanstack/ai-anthropic'

import { runRecallForTurn, runTurn } from '#/server/memory/orchestrator'
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
          let recallLatencyMs = 0
          if (sessionId && engineId && userText) {
            const recall = await runRecallForTurn(sessionId, engineId, userText)
            fragments = recall.fragments
            recallLatencyMs = recall.latencyMs
          }

          const systemPrompt = buildSystemPrompt(fragments)

          const g = globalThis as any
          g.__lastRecallBySession = g.__lastRecallBySession ?? {}
          if (sessionId) {
            g.__lastRecallBySession[sessionId] = {
              sessionId,
              engineId,
              query: userText,
              fragments,
              latencyMs: recallLatencyMs,
              systemPrompt,
              takenAt: new Date().toISOString(),
            }
          }

          const adapter = anthropicText(MODEL_CHAT)

          const stream = chat({
            adapter,
            systemPrompts: [systemPrompt],
            messages: messages as any,
            abortController,
            middleware: [
              {
                name: 'memory-retain',
                onFinish: (ctx, info) => {
                  if (!sessionId || !userText) return
                  const assistantReply = info.content ?? ''
                  if (!assistantReply) return
                  const work = (async () => {
                    try {
                      const turn = await runTurn({
                        sessionId,
                        userMsg: userText,
                        assistantReply,
                        activeEngineId: engineId,
                        recall: {
                          engineId,
                          result: {
                            engine: engineId,
                            latencyMs: recallLatencyMs,
                            fragments,
                            raw: null,
                          },
                          query: userText,
                        },
                      })
                      const g2 = globalThis as any
                      g2.__lastTurnBySession = g2.__lastTurnBySession ?? {}
                      g2.__lastTurnBySession[sessionId] = {
                        turnId: turn.turnId,
                        receipts: turn.receipts,
                        takenAt: new Date().toISOString(),
                      }
                    } catch (err) {
                      console.error('[api/chat] server-side retain failed:', err)
                    }
                  })()
                  ctx.defer(work)
                },
              },
            ],
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
