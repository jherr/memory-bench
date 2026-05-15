import { createFileRoute } from '@tanstack/react-router'
import { chat, toServerSentEventsResponse } from '@tanstack/ai'
import { anthropicText } from '@tanstack/ai-anthropic'
import {
  composeMemoryMiddleware,
  createMemoryMiddleware,
} from '@tanstack/ai-memory/middleware'
import { z } from 'zod'

import {
  getEngine,
  listEnabledEngines,
  runTurnPersist,
} from '#/server/memory/orchestrator'
import { toolEventSinkForSession } from '#/server/memory/tool-event-buffer'
import { isValidEngineId, isValidSessionId } from '#/server/validation/ids'
import type { EngineId, RetainReceipt } from '@tanstack/ai-memory'
import type { MemoryRecallRef } from '@tanstack/ai-memory/middleware'

const MODEL_CHAT = (process.env.MODEL_CHAT ??
  'claude-sonnet-4-5') as Parameters<typeof anthropicText>[0]

const BASE_SYSTEM_PROMPT = `You are an experimental assistant inside a memory-bench harness.

You have access to memory that was recalled for this turn. Use it freely if it is relevant; do not mention the recall step itself. If the recalled memory is empty, answer normally without commenting on its absence.

Keep replies concise unless the user asks for depth.`

function createReceiptAggregator(
  engineIds: Array<EngineId>,
  persist: (
    receipts: Array<RetainReceipt>,
    recall: MemoryRecallRef | null,
    assistant: string,
  ) => Promise<void>,
) {
  const receiptBatches = new Map<EngineId, Array<RetainReceipt>>()
  let recallRef: MemoryRecallRef | null = null
  let assistantReply = ''
  let persisted = false

  return async (args: {
    engineId: EngineId
    assistant: string
    receipts: Array<RetainReceipt>
    recall: MemoryRecallRef | null
  }) => {
    receiptBatches.set(args.engineId, args.receipts)
    recallRef = args.recall ?? recallRef
    assistantReply = args.assistant || assistantReply

    if (persisted || receiptBatches.size < engineIds.length) return
    persisted = true
    const receipts = engineIds.flatMap((engineId) =>
      receiptBatches.get(engineId) ?? [],
    )
    await persist(receipts, recallRef, assistantReply)
  }
}

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
              `[api/chat] hit: engine=${engineId} session=${sessionId?.slice(0, 12)} msgs=${messages?.length}`,
            )
          }

          const adapter = anthropicText(MODEL_CHAT)
          const memoryMiddleware = sessionId
            ? (() => {
                const engines = listEnabledEngines()
                const engineIds = engines.map((engine) => engine.id)
                const persistRetains = createReceiptAggregator(
                  engineIds,
                  async (receipts, recall, assistantReply) => {
                    try {
                      const userMsg = recall?.query ?? ''
                      if (!userMsg) return
                      const turn = await runTurnPersist({
                        sessionId,
                        userMsg,
                        assistantReply,
                        activeEngineId: engineId,
                        receipts,
                        recall,
                        snapshotEngineIds: engineIds,
                      })
                      const g = globalThis as any
                      g.__lastTurnBySession = g.__lastTurnBySession ?? {}
                      g.__lastTurnBySession[sessionId] = {
                        turnId: turn.turnId,
                        receipts: turn.receipts,
                        takenAt: new Date().toISOString(),
                      }
                    } catch (err) {
                      console.error('[api/chat] server-side retain failed:', err)
                    }
                  },
                )

                return [
                  composeMemoryMiddleware(
                    engines.map((engine) =>
                      createMemoryMiddleware({
                        engine: getEngine(engine.id),
                        scope: {
                          sessionId,
                          toolEvents: toolEventSinkForSession(sessionId),
                        },
                        role:
                          engine.id === engineId
                            ? 'recall+retain'
                            : 'retain-only',
                        onRecallComplete: ({
                          query,
                          result,
                          systemPrompts,
                        }) => {
                          const g = globalThis as any
                          g.__lastRecallBySession =
                            g.__lastRecallBySession ?? {}
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
                        onRetainComplete: persistRetains,
                      }),
                    ),
                  ),
                ]
              })()
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
