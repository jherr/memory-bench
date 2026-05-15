# @tanstack/ai-memory

Middleware-first long-term memory for TanStack AI.

`@tanstack/ai-memory` gives you:

- A small `MemoryDriver` protocol for retain, recall, inspect, and list.
- TanStack AI `ChatMiddleware` helpers that wire memory into `chat()`.
- Vendor drivers for Hindsight, mem0, and Honcho.
- A composition kit for building your own memory driver from stages.

LLM applications usually combine several different kinds of "memory":

- **Context-window memory**: the messages and documents sent with the current
  model call. This is immediate, precise, and disappears when it leaves the
  prompt.
- **Working memory**: short-lived state for an active run or agent loop, such
  as intermediate tool results, plans, scratchpads, or streamed state.
- **Retrieval memory**: external knowledge retrieved from files, databases,
  vector stores, or search indexes. This is usually about source material, not
  what the assistant learned from previous conversations.
- **Long-term user/application memory**: durable facts, preferences,
  observations, summaries, or experiences retained across turns and sessions.
- **Model memory**: information baked into model weights during training or
  fine-tuning. Applications can use it, but cannot reliably inspect or update
  it per user at runtime.

This package fits in the **long-term user/application memory** layer. It
recalls relevant durable memory before generation, optionally exposes memory
tools to the model, and retains the completed user/assistant turn afterward.

The current recommended integration is TanStack AI middleware:

- Before the model runs, memory recall is injected into `systemPrompts`.
- Any memory tools returned by the driver are injected into `tools`.
- After the model finishes, the user/assistant turn is retained with
  `ctx.defer(...)` so streaming is not blocked.

## Installation

In this workspace:

```bash
pnpm add @tanstack/ai @tanstack/ai-memory
```

For the Hindsight and Honcho providers, the package imports their SDKs from
the provider subpaths:

```ts
import { hindsightEngine } from '@tanstack/ai-memory/hindsight'
import { honchoEngine } from '@tanstack/ai-memory/honcho'
```

mem0 uses direct HTTP calls and does not require a mem0 SDK:

```ts
import { mem0Engine } from '@tanstack/ai-memory/mem0'
```

The middleware helpers are exported separately:

```ts
import {
  createMemoryMiddleware,
  composeMemoryMiddleware,
} from '@tanstack/ai-memory/middleware'
```

## How Memory Works

Every provider implements the same `MemoryDriver` contract:

```ts
interface MemoryDriver {
  id: EngineId
  recall(scope: Scope, query: string): Promise<RecallResult>
  retainTurn(scope: Scope, input: RetainInput): Promise<Array<RetainReceipt>>
  inspect(scope: Scope): Promise<MemorySnapshot>
  listFacts(scope: Scope): Promise<FactList>
}
```

The runtime flow is:

1. The user sends a message.
2. `createMemoryMiddleware` reads the latest user message during `onConfig`.
3. The selected driver runs `recall(scope, userText)`.
4. The middleware appends recalled memory and tool guidance to
   `systemPrompts`.
5. The middleware appends any returned memory tools to `tools`.
6. TanStack AI runs the model and any tools normally.
7. On `onFinish`, the middleware calls `retainTurn(scope, { user, assistant })`
   in a deferred side effect.

`Scope` tells a driver where the memory belongs:

```ts
type Scope = {
  sessionId: string
  userId?: string
  toolEvents?: MemoryToolEventSink
}
```

Drivers interpret that scope differently. Hindsight stores by
`userId + sessionId`, mem0 stores by `userId`, and Honcho stores by workspace,
peer, and session.

## Simple Example: Hindsight

Start Hindsight locally first:

```bash
cd apps/web
cp .env.example .env
# Fill ANTHROPIC_API_KEY in .env
docker compose --profile hindsight up -d
```

Then wire Hindsight into TanStack AI middleware:

```ts
import { chat, toServerSentEventsResponse } from '@tanstack/ai'
import { anthropicText } from '@tanstack/ai-anthropic'
import { createMemoryMiddleware } from '@tanstack/ai-memory/middleware'
import { hindsightEngine } from '@tanstack/ai-memory/hindsight'

export async function POST(request: Request) {
  const { messages, sessionId, userId } = await request.json()
  const abortController = new AbortController()

  const memory = createMemoryMiddleware({
    engine: hindsightEngine,
    scope: {
      sessionId,
      userId,
    },
    role: 'recall+retain',
    // Optional: observe recalled memory for logging, telemetry, or UI state.
    onRecallComplete({ query, result }) {
      console.log('memory recall', {
        query,
        fragments: result.fragments ?? [],
        latencyMs: result.latencyMs,
      })
    },
    // Optional: observe retain receipts after the finished turn is written.
    onRetainComplete({ receipts }) {
      console.log('memory retain', receipts)
    },
  })

  const stream = chat({
    adapter: anthropicText('claude-sonnet-4-5'),
    systemPrompts: [
      'You are a helpful assistant. Use recalled memory when relevant.',
    ],
    messages,
    abortController,
    middleware: [memory],
  })

  return toServerSentEventsResponse(stream, { abortController })
}
```

`role` controls which parts of the middleware lifecycle this engine handles:

- `recall+retain`: run recall during `onConfig`, inject recalled prompts and
  tools into the chat config, then retain the completed turn during
  `onFinish`. Use this for the engine that should influence the model's
  current response.
- `retain-only`: skip recall and only retain the completed turn during
  `onFinish`. Use this when you want to write the same conversation into
  additional memory systems without letting them all modify the prompt.

`onRecallComplete` and `onRetainComplete` are optional callbacks for logging,
telemetry, persistence, or UI timelines. They do not change what the model
sees unless your callback changes app state outside the middleware.

With Hindsight, `recall()` returns three LLM-callable tools as normal TanStack
AI tools:

- `hindsight_retain(content)`
- `hindsight_recall(query)`
- `hindsight_reflect(question)`

You do not call those tools manually. The middleware injects them into
`chat({ tools })`, and TanStack AI executes them through the regular tool
calling path.

## Multi-Engine Middleware

Use `composeMemoryMiddleware` when you want a proxy middleware that delegates
to multiple memory middlewares. A common pattern is one active
`recall+retain` engine and several `retain-only` engines:

```ts
import {
  composeMemoryMiddleware,
  createMemoryMiddleware,
} from '@tanstack/ai-memory/middleware'
import { hindsightEngine } from '@tanstack/ai-memory/hindsight'
import { mem0Engine } from '@tanstack/ai-memory/mem0'
import { honchoEngine } from '@tanstack/ai-memory/honcho'

const middleware = composeMemoryMiddleware([
  createMemoryMiddleware({
    engine: hindsightEngine,
    scope,
    role: 'recall+retain',
  }),
  createMemoryMiddleware({
    engine: mem0Engine,
    scope,
    role: 'retain-only',
  }),
  createMemoryMiddleware({
    engine: honchoEngine,
    scope,
    role: 'retain-only',
  }),
])
```

`retain-only` middleware skips recall and only writes the finished turn.

## Vendor Instructions

Provider modules are preconfigured singletons. Set environment variables
before importing the provider module.

### Hindsight

Import:

```ts
import { hindsightEngine } from '@tanstack/ai-memory/hindsight'
```

Environment:

```bash
HINDSIGHT_URL=http://localhost:8888
```

Docker:

```bash
cd apps/web
cp .env.example .env
# Fill ANTHROPIC_API_KEY in .env
docker compose --profile hindsight up -d
```

Ports:

- API: `http://localhost:8888`
- UI: `http://localhost:9999`

Behavior:

- `recall()` calls Hindsight recall with `budget: 'mid'`.
- `retainTurn()` stores the user and assistant messages as separate retain
  calls with `chat:user` and `chat:assistant` context.
- `recall()` returns the Hindsight tools, so this provider supports both
  automatic memory and direct model-controlled memory operations.
- Bank id is `${userId}__${sessionId}`, falling back to `demo-user` when
  `userId` is omitted.

### mem0

Import:

```ts
import { mem0Engine } from '@tanstack/ai-memory/mem0'
```

Environment:

```bash
MEM0_URL=http://localhost:8000
MEM0_ADMIN_API_KEY= # optional; sent as Authorization: Bearer when set
```

Docker:

```bash
cd apps/web
cp .env.example .env
# Fill OPENAI_API_KEY in .env
docker compose --profile mem0 up -d
```

Ports:

- API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

Behavior:

- `recall()` calls `POST /search`.
- `retainTurn()` calls `POST /memories` with a two-message conversation.
- mem0 scopes memory by `user_id`; `sessionId` is not used by this provider.
- No tools are returned. mem0 is middleware-only in this package.

### Honcho

Import:

```ts
import { honchoEngine } from '@tanstack/ai-memory/honcho'
```

Environment:

```bash
HONCHO_URL=http://localhost:8001
HONCHO_APP_NAME=ai-memory
HONCHO_API_KEY= # optional locally; defaults to dev-no-auth
```

Docker:

```bash
cd apps/web
cp .env.example .env
# Fill ANTHROPIC_API_KEY in .env
docker compose --profile honcho up -d
```

Ports:

- API: `http://localhost:8001`

Behavior:

- `recall()` calls `userPeer.chat(query, { session })` and uses the returned
  synthesis as a system prompt.
- `retainTurn()` adds user and assistant messages to the Honcho session.
- Honcho derives memory asynchronously, so new facts may take several seconds
  to appear in `inspect()` or `listFacts()`.
- No tools are returned. Honcho is middleware-only in this package.
- Scope maps to workspace (`HONCHO_APP_NAME`), user peer (`userId`), assistant
  peer (`assistant`), and session (`sessionId`).

### Running All Engines

From the example app:

```bash
cd apps/web
cp .env.example .env
# Fill ANTHROPIC_API_KEY and OPENAI_API_KEY as needed
docker compose --profile engines up -d
```

This starts Hindsight, mem0, Honcho, and their backing services.

## Building Your Own Driver

If a vendor does not fit your app, implement `MemoryDriver` directly or use
`createComposedDriver` with stages:

- `Extractor`
- `Consolidator`
- `FactStore`
- `Renderer`
- optional `ToolFactory`

See:

- [`docs/protocol.md`](./docs/protocol.md)
- [`docs/composition.md`](./docs/composition.md)
- [`apps/web/src/memory/drivers/local.ts`](../../apps/web/src/memory/drivers/local.ts)
