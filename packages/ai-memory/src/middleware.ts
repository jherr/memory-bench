import type {
  ChatMiddleware,
  ChatMiddlewareConfig,
  StreamChunk,
} from '@tanstack/ai'

import type {
  EngineId,
  MemoryDriver,
  RecallResult,
  RetainReceipt,
  Scope,
} from './index'

export type MemoryMiddlewareRole = 'recall+retain' | 'retain-only'

export interface MemoryRecallRef {
  engineId: EngineId
  query: string
  result: RecallResult
}

export interface MemoryRetainCompleteInfo {
  engineId: EngineId
  user: string
  assistant: string
  receipts: Array<RetainReceipt>
  recall: MemoryRecallRef | null
}

export interface MemoryRecallCompleteInfo {
  engineId: EngineId
  query: string
  result: RecallResult
  systemPrompts: Array<string>
}

export interface CreateMemoryMiddlewareOptions {
  engine: MemoryDriver
  scope: Scope
  role?: MemoryMiddlewareRole
  onRecallComplete?: (info: MemoryRecallCompleteInfo) => void | Promise<void>
  onRetainComplete?: (info: MemoryRetainCompleteInfo) => void | Promise<void>
}

type MaybeMessage = {
  role?: unknown
  content?: unknown
  parts?: unknown
}

function textFromPart(part: unknown): string {
  if (!part || typeof part !== 'object') return ''
  const p = part as { type?: unknown; content?: unknown; text?: unknown }
  if (p.type !== 'text') return ''
  if (typeof p.content === 'string') return p.content
  if (typeof p.text === 'string') return p.text
  return ''
}

export function getLastUserText(messages: ReadonlyArray<unknown>): string {
  for (const message of [...messages].reverse()) {
    if (!message || typeof message !== 'object') continue
    const m = message as MaybeMessage
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.parts)) {
      return m.parts.map(textFromPart).filter(Boolean).join('\n')
    }
    return ''
  }
  return ''
}

function appendMemoryPrompts(
  systemPrompts: Array<string>,
  recall: RecallResult,
): Array<string> {
  return [
    ...systemPrompts,
    recall.toolGuidance,
    recall.systemPrompt,
  ].filter((prompt) => prompt.length > 0)
}

export function createMemoryMiddleware(
  options: CreateMemoryMiddlewareOptions,
): ChatMiddleware {
  const role = options.role ?? 'recall+retain'
  let userText = ''
  let recall: MemoryRecallRef | null = null

  return {
    name: `memory:${options.engine.id}:${role}`,

    async onConfig(ctx, config) {
      if (ctx.phase !== 'init' || role === 'retain-only') {
        return undefined
      }

      userText = getLastUserText(config.messages)
      if (!userText) {
        return undefined
      }

      const result = await options.engine.recall(options.scope, userText)
      recall = {
        engineId: options.engine.id,
        query: userText,
        result,
      }
      const systemPrompts = appendMemoryPrompts(config.systemPrompts, result)
      await options.onRecallComplete?.({
        engineId: options.engine.id,
        query: userText,
        result,
        systemPrompts,
      })

      return {
        systemPrompts,
        tools: [...config.tools, ...result.tools],
      }
    },

    onFinish(ctx, info) {
      if (!userText) {
        userText = getLastUserText(ctx.messages)
      }
      if (!userText || !info.content) return

      const assistant = info.content
      ctx.defer(
        (async () => {
          let receipts: Array<RetainReceipt>
          try {
            receipts = await options.engine.retainTurn(options.scope, {
              user: userText,
              assistant,
            })
          } catch (error) {
            receipts = [
              {
                engine: options.engine.id,
                ok: false,
                latencyMs: 0,
                raw: null,
                error: String(error),
              },
            ]
          }
          await options.onRetainComplete?.({
            engineId: options.engine.id,
            user: userText,
            assistant,
            receipts,
            recall,
          })
        })(),
      )
    },
  }
}

export function composeMemoryMiddleware(
  middlewares: Array<ChatMiddleware>,
): ChatMiddleware {
  return {
    name: 'memory:compose',

    async onConfig(ctx, config) {
      let current: ChatMiddlewareConfig = config
      let changed = false
      for (const middleware of middlewares) {
        const result = await middleware.onConfig?.(ctx, current)
        if (result !== undefined && result !== null) {
          current = { ...current, ...result }
          changed = true
        }
      }
      return changed ? current : undefined
    },

    async onStart(ctx) {
      for (const middleware of middlewares) {
        await middleware.onStart?.(ctx)
      }
    },

    async onIteration(ctx, info) {
      for (const middleware of middlewares) {
        await middleware.onIteration?.(ctx, info)
      }
    },

    async onChunk(ctx, chunk) {
      let chunks: Array<StreamChunk> = [chunk]
      for (const middleware of middlewares) {
        if (!middleware.onChunk) continue
        const next: Array<StreamChunk> = []
        for (const current of chunks) {
          const result = await middleware.onChunk(ctx, current)
          if (result === null) continue
          if (result === undefined) {
            next.push(current)
          } else if (Array.isArray(result)) {
            next.push(...result)
          } else {
            next.push(result)
          }
        }
        chunks = next
      }
      if (chunks.length === 0) return null
      if (chunks.length === 1) return chunks[0]
      return chunks
    },

    async onBeforeToolCall(ctx, hookCtx) {
      for (const middleware of middlewares) {
        const decision = await middleware.onBeforeToolCall?.(ctx, hookCtx)
        if (decision !== undefined && decision !== null) {
          return decision
        }
      }
      return undefined
    },

    async onAfterToolCall(ctx, info) {
      for (const middleware of middlewares) {
        await middleware.onAfterToolCall?.(ctx, info)
      }
    },

    async onToolPhaseComplete(ctx, info) {
      for (const middleware of middlewares) {
        await middleware.onToolPhaseComplete?.(ctx, info)
      }
    },

    async onUsage(ctx, usage) {
      for (const middleware of middlewares) {
        await middleware.onUsage?.(ctx, usage)
      }
    },

    async onFinish(ctx, info) {
      for (const middleware of middlewares) {
        await middleware.onFinish?.(ctx, info)
      }
    },

    async onAbort(ctx, info) {
      for (const middleware of middlewares) {
        await middleware.onAbort?.(ctx, info)
      }
    },

    async onError(ctx, info) {
      for (const middleware of middlewares) {
        await middleware.onError?.(ctx, info)
      }
    },
  }
}
