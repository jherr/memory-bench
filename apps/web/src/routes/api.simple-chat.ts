import { createFileRoute } from '@tanstack/react-router'
import { chat, toServerSentEventsResponse } from '@tanstack/ai'
import { anthropicText } from '@tanstack/ai-anthropic'
import { createMemoryMiddleware } from '@tanstack/ai-memory/middleware'
import { z } from 'zod'

import { getEngine, runSimpleTurnPersist } from '#/server/memory/orchestrator'
import { toolEventSinkForSession } from '#/server/memory/tool-event-buffer'
import { isValidEngineId, isValidSessionId } from '#/server/validation/ids'
import type { EngineId } from '@tanstack/ai-memory'

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

          const adapter = anthropicText(MODEL_CHAT)
          const memoryMiddleware = sessionId
            ? [
                createMemoryMiddleware({
                  engine: getEngine(engineId),
                  scope: {
                    sessionId,
                    toolEvents: toolEventSinkForSession(sessionId),
                  },
                  role: 'recall+retain',
                  onRecallComplete: ({ query, result, systemPrompts }) => {
                    const g = globalThis as any
                    g.__lastRecallBySession = g.__lastRecallBySession ?? {}
                    g.__lastRecallBySession[sessionId] = {
                      sessionId,
                      engineId,
                      query,
                      fragments: result.fragments ?? [],
                      latencyMs: result.latencyMs,
                      systemPrompt: systemPrompts.join('\n\n'),
                      engineSystemPrompt: result.systemPrompt,
                      toolGuidance: result.toolGuidance,
                      toolCount: result.tools.length,
                      takenAt: new Date().toISOString(),
                    }
                  },
                  onRetainComplete: async ({
                    user,
                    assistant,
                    receipts,
                    recall,
                  }) => {
                    try {
                      const turn = await runSimpleTurnPersist({
                        sessionId,
                        userMsg: user,
                        assistantReply: assistant,
                        activeEngineId: engineId,
                        receipts,
                        recall,
                      })
                      const g = globalThis as any
                      g.__lastTurnBySession = g.__lastTurnBySession ?? {}
                      g.__lastTurnBySession[sessionId] = {
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
                  },
                }),
              ]
            : []

          const stream = chat({
            adapter,
            systemPrompts: [BASE_SYSTEM_PROMPT],
            messages: messages as any,
            abortController,
            middleware: memoryMiddleware,
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
