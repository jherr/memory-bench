import { createFileRoute } from '@tanstack/react-router'
import { chat, toServerSentEventsResponse } from '@tanstack/ai'
import { anthropicText } from '@tanstack/ai-anthropic'
import { z } from 'zod'

import { runRecallForTurn, runSimpleTurn } from '#/server/memory/orchestrator'
import { isValidEngineId, isValidSessionId } from '#/server/validation/ids'
import type { EngineId, RecallResult } from '@tanstack/ai-memory'

const MODEL_CHAT = (process.env.MODEL_CHAT ??
  'claude-sonnet-4-5') as Parameters<typeof anthropicText>[0]

const BASE_SYSTEM_PROMPT = `You are a helpful assistant with access to persistent memory.

You may have memory recalled for this turn. Use it freely if it is relevant; do not mention the recall step itself. If the recalled memory is empty, answer normally without commenting on its absence.

Keep replies concise unless the user asks for depth.`

const chatRequestSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant', 'tool']),
            content: z.string().optional(),
            parts: z
              .array(
                z.object({
                  type: z.string(),
                  content: z.string().optional(),
                }),
              )
              .optional(),
          })
          .passthrough(),
      )
      .min(1),
    data: z
      .object({
        sessionId: z.string().optional(),
        engineId: z.string().optional(),
      })
      .optional(),
    sessionId: z.string().optional(),
    engineId: z.string().optional(),
  })
  .passthrough()

export const Route = createFileRoute('/api/simple-chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestSignal = request.signal
        if (requestSignal.aborted) {
          return new Response(null, { status: 499 })
        }
        const abortController = new AbortController()

        try {
          const parsed = chatRequestSchema.safeParse(await request.json())
          if (!parsed.success) {
            return new Response(JSON.stringify({ error: 'invalid chat payload' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          const body = parsed.data
          const messages = body.messages
          const sessionId = body.data?.sessionId ?? body.sessionId ?? ''
          const requestedEngineId = body.data?.engineId ?? body.engineId
          if (sessionId && !isValidSessionId(sessionId)) {
            return new Response(JSON.stringify({ error: 'invalid session id' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          if (requestedEngineId && !isValidEngineId(requestedEngineId)) {
            return new Response(JSON.stringify({ error: 'invalid engine id' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          const engineId = (requestedEngineId ?? 'hindsight') as EngineId
          if (process.env.DEBUG_CHAT === '1') {
            console.log(
              `[api/simple-chat] hit: engine=${engineId} session=${sessionId?.slice(0, 12)} msgs=${messages?.length}`,
            )
          }

          const lastUser = [...messages]
            .reverse()
            .find((m) => m.role === 'user')
          const userText =
            (lastUser?.content as string | undefined) ??
            (Array.isArray(lastUser?.parts)
              ? lastUser!.parts
                  .filter((p) => p?.type === 'text')
                  .map((p) => p.content)
                  .join('\n')
              : '')

          let recall: RecallResult | null = null
          if (sessionId && engineId && userText) {
            recall = await runRecallForTurn(sessionId, engineId, userText)
          }

          const systemPrompt = [
            BASE_SYSTEM_PROMPT,
            recall?.toolGuidance ?? '',
            recall?.systemPrompt ?? '',
          ]
            .filter((s) => s.length > 0)
            .join('\n\n')

          const g = globalThis as any
          g.__lastRecallBySession = g.__lastRecallBySession ?? {}
          if (sessionId) {
            g.__lastRecallBySession[sessionId] = {
              sessionId,
              engineId,
              query: userText,
              fragments: recall?.fragments ?? [],
              latencyMs: recall?.latencyMs ?? 0,
              systemPrompt,
              engineSystemPrompt: recall?.systemPrompt ?? '',
              toolGuidance: recall?.toolGuidance ?? '',
              toolCount: recall?.tools.length ?? 0,
              takenAt: new Date().toISOString(),
            }
          }

          const adapter = anthropicText(MODEL_CHAT)

          const stream = chat({
            adapter,
            systemPrompts: [systemPrompt],
            messages: messages as any,
            tools: recall?.tools ?? [],
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
                      const turn = await runSimpleTurn({
                        sessionId,
                        userMsg: userText,
                        assistantReply,
                        activeEngineId: engineId,
                        recall: recall
                          ? {
                              engineId,
                              result: recall,
                              query: userText,
                            }
                          : null,
                      })
                      const g2 = globalThis as any
                      g2.__lastTurnBySession = g2.__lastTurnBySession ?? {}
                      g2.__lastTurnBySession[sessionId] = {
                        turnId: turn.turnId,
                        receipts: turn.receipts,
                        takenAt: new Date().toISOString(),
                      }
                    } catch (err) {
                      console.error(
                        '[api/simple-chat] server-side retain failed:',
                        err,
                      )
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
          console.error('[api/simple-chat] error:', error)
          return new Response(
            JSON.stringify({ error: 'Failed to process chat request' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
