import { describe, expect, it } from 'vitest'
import type { ChatMiddlewareConfig, ChatMiddlewareContext } from '@tanstack/ai'
import type { MemoryDriver, RecallResult, RetainReceipt, Scope } from '@tanstack/ai-memory'
import {
  composeMemoryMiddleware,
  createMemoryMiddleware,
} from '@tanstack/ai-memory/middleware'

function makeContext(): ChatMiddlewareContext {
  const deferred: Array<Promise<unknown>> = []
  const ctx = {
    requestId: 'request-1',
    streamId: 'stream-1',
    phase: 'init',
    iteration: 0,
    chunkIndex: 0,
    abort: () => {},
    context: undefined,
    defer: (promise: Promise<unknown>) => {
      deferred.push(promise)
    },
    provider: 'test',
    model: 'test-model',
    source: 'server',
    streaming: true,
    systemPrompts: [],
    modelOptions: {},
    messageCount: 1,
    hasTools: false,
    currentMessageId: null,
    accumulatedContent: '',
    messages: [],
    createId: (prefix: string) => `${prefix}-1`,
    deferred,
  } as unknown as ChatMiddlewareContext & { deferred: Array<Promise<unknown>> }
  return ctx
}

function makeConfig(): ChatMiddlewareConfig {
  return {
    messages: [{ role: 'user', content: 'remember my color' }],
    systemPrompts: ['base'],
    tools: [],
  } as ChatMiddlewareConfig
}

function makeRecall(): RecallResult {
  return {
    engine: 'local',
    latencyMs: 1,
    systemPrompt: 'Recalled memory:\n- favorite color is teal',
    fragments: [{ text: 'favorite color is teal', source: 'local#1' }],
    tools: [
      {
        name: 'remember_tool',
        description: 'test tool',
        inputSchema: {} as never,
      },
    ],
    toolGuidance: 'Use memory tools when relevant.',
    raw: {},
  }
}

function makeReceipt(): RetainReceipt {
  return {
    engine: 'local',
    ok: true,
    latencyMs: 1,
    raw: {},
  }
}

function makeDriver(scopeCalls: Array<Scope>): MemoryDriver {
  const recall = makeRecall()
  const receipt = makeReceipt()
  return {
    id: 'local',
    async retainTurn(scope, input) {
      scopeCalls.push(scope)
      expect(input).toEqual({
        user: 'remember my color',
        assistant: 'Done.',
      })
      return [receipt]
    },
    async recall(scope, query) {
      scopeCalls.push(scope)
      expect(query).toBe('remember my color')
      return recall
    },
    async inspect() {
      return { engine: 'local', takenAt: new Date().toISOString(), data: {} }
    },
    async listFacts() {
      return { engine: 'local', facts: [], takenAt: new Date().toISOString() }
    },
  }
}

describe('createMemoryMiddleware', () => {
  it('recalls memory during init config and appends prompt text and tools', async () => {
    const scopeCalls: Array<Scope> = []
    const recalls: Array<{ query: string; result: RecallResult }> = []
    const middleware = createMemoryMiddleware({
      engine: makeDriver(scopeCalls),
      scope: { sessionId: 'session-1' },
      role: 'recall+retain',
      onRecallComplete: ({ query, result }) => {
        recalls.push({ query, result })
      },
    })

    const transformed = await middleware.onConfig?.(makeContext(), makeConfig())

    expect(transformed?.systemPrompts).toEqual([
      'base',
      'Use memory tools when relevant.',
      'Recalled memory:\n- favorite color is teal',
    ])
    expect(transformed?.tools).toHaveLength(1)
    expect(recalls).toEqual([
      { query: 'remember my color', result: makeRecall() },
    ])
    expect(scopeCalls).toEqual([{ sessionId: 'session-1' }])
  })

  it('defers retain on finish and reports receipts with recall context', async () => {
    const ctx = makeContext() as ChatMiddlewareContext & {
      deferred: Array<Promise<unknown>>
    }
    const receipts: Array<RetainReceipt> = []
    const middleware = createMemoryMiddleware({
      engine: makeDriver([]),
      scope: { sessionId: 'session-1' },
      role: 'recall+retain',
      onRetainComplete: ({ receipts: next }) => {
        receipts.push(...next)
      },
    })

    await middleware.onConfig?.(ctx, makeConfig())
    await middleware.onFinish?.(ctx, {
      finishReason: 'stop',
      duration: 1,
      content: 'Done.',
    })
    await Promise.all(ctx.deferred)

    expect(receipts).toEqual([makeReceipt()])
  })
})

describe('composeMemoryMiddleware', () => {
  it('proxies hooks through child middleware in order', async () => {
    const calls: Array<string> = []
    const middleware = composeMemoryMiddleware([
      {
        name: 'first',
        onConfig: () => {
          calls.push('first:config')
          return { systemPrompts: ['first'] }
        },
        onFinish: () => {
          calls.push('first:finish')
        },
      },
      {
        name: 'second',
        onConfig: (_ctx, config) => {
          calls.push(config.systemPrompts[0])
          return { systemPrompts: [...config.systemPrompts, 'second'] }
        },
        onFinish: () => {
          calls.push('second:finish')
        },
      },
    ])

    const transformed = await middleware.onConfig?.(makeContext(), makeConfig())
    await middleware.onFinish?.(makeContext(), {
      finishReason: 'stop',
      duration: 1,
      content: 'Done.',
    })

    expect(transformed?.systemPrompts).toEqual(['first', 'second'])
    expect(calls).toEqual([
      'first:config',
      'first',
      'first:finish',
      'second:finish',
    ])
  })
})
