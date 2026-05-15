# protocol.md

The `MemoryDriver` contract. Every implementation in `@tanstack/ai-memory` —
whether shipped (Hindsight, mem0, Honcho) or user-built — satisfies this
interface.

All type signatures in this document are copy-pasted from
[`src/index.ts`](../src/index.ts) and [`src/types/stages.ts`](../src/types/stages.ts).
The code is the source of truth; if this document and the code disagree, the
code is right.

## What a driver is

A `MemoryDriver` is the object the chat route consumes. It exposes four
operations and an identifier:

```ts
export interface MemoryDriver {
  id: EngineId
  retainTurn(scope: Scope, input: RetainInput): Promise<Array<RetainReceipt>>
  recall(scope: Scope, query: string): Promise<RecallResult>
  inspect(scope: Scope): Promise<MemorySnapshot>
  listFacts(scope: Scope): Promise<FactList>
}
```

The driver may internally wrap a hosted memory service, compose pipeline
stages (see [`composition.md`](./composition.md)), or do anything else that
satisfies the contract. The chat route does not know or care which.

`EngineId` is a closed union of the engines the bench currently knows about:

```ts
export type EngineId = 'hindsight' | 'mem0' | 'honcho' | 'local'
```

If you add a new driver, widen `EngineId` first.

## Lifecycle

Four call sites, four reasons.

### `recall(scope, query)` — before every LLM turn

The chat route calls `recall()` immediately before assembling the system
prompt for the LLM. The returned `RecallResult` contributes three things to
the turn:

- `systemPrompt`: a pre-rendered block of recalled memory in the driver's
  native shape. The chat route concatenates it into the LLM system prompt.
  Empty string means "no memory contributed for this turn."
- `tools`: tool definitions the driver wants exposed to the LLM during this
  turn. Empty array if the driver doesn't expose tools.
- `toolGuidance`: system prompt addition explaining when and how to use the
  tools. Empty string if `tools` is empty.

The driver decides what "recall" means. Some drivers run vector search
against a fact store; some call a remote synthesis endpoint that returns a
paragraph; some do both. The chat route's job is to use the result, not to
interpret it.

### `retainTurn(scope, input)` — after every LLM turn

The chat route fires `retainTurn()` (typically via a deferred middleware so
it doesn't block the stream) after the LLM response completes. Both the
user message and the assistant response are passed together:

```ts
export interface RetainInput {
  user: string
  assistant: string
}
```

The driver decides whether to extract, dedup, consolidate, or store raw, and
whether to fire one write or several. `retainTurn` returns
`Array<RetainReceipt>` because some drivers (e.g. Hindsight) fan out into
multiple underlying calls. The receipts are for logging and observability;
the chat route does not act on them.

Failures should be returned as receipts with `ok: false` and an error string
rather than thrown — retain failures should not break the user-facing turn.

### `inspect(scope)` — on UI demand

The UI calls `inspect()` to render the driver's current memory state in a
panel. The shape of `data` is engine-specific and the panel is engine-aware.
Inspect is read-only and should not trigger side effects.

### `listFacts(scope)` — for fact-level views

The bench exposes a uniform "memories" panel across engines that needs a
flat list of facts, not the engine's full inspection payload. `listFacts`
returns that flat list normalized to a single shape (`MemoryFact`). Drivers
build the list however they like; for example, Honcho parses
`peer.representation()` into rows, mem0 maps `GET /memories`, the composed
driver reads from its `FactStore`.

### Tool calls during the LLM stream

If `recall()` returned tools, the LLM may invoke them mid-stream. Tool
invocations are first-class: their results flow back into the LLM's
reasoning the same way any other tool's results do. The driver is
responsible for the tool implementations and for distinguishing tool-driven
operations from middleware-driven operations in any logging it does. The
optional `scope.toolEvents` sink (see below) is how the bench captures
those events for the inspector.

## Data shapes

### `Scope`

```ts
export interface Scope {
  sessionId: string
  userId?: string
  toolEvents?: MemoryToolEventSink
}
```

The driver maps `Scope` to its internal identifiers. A driver wrapping a
service that has only a user concept ignores `sessionId`. A driver scoped to
sessions ignores `userId`. The chat route always passes both.

`toolEvents` is an optional sink the chat route can attach so the driver can
report tool-driven retain and recall events back to the orchestrator (the
event types are below). Drivers that don't expose tools, or that don't want
to participate in event capture, leave `toolEvents` alone.

```ts
export interface MemoryToolEventSink {
  onToolRetain?: (event: ToolRetainEvent) => void
  onToolRecall?: (event: ToolRecallEvent) => void
}

export interface ToolRetainEvent {
  engine: EngineId
  receipt: RetainReceipt
}

export interface ToolRecallEvent {
  engine: EngineId
  query: string
  result: RecallResult
}
```

### `RecallResult`

```ts
export interface RecallResult {
  engine: EngineId
  latencyMs: number
  /** Pre-rendered block ready to drop into the LLM system prompt. */
  systemPrompt: string
  /** Discrete items when the engine produces them; omitted for synthesized output. */
  fragments?: Array<RecallFragment>
  /** Tools the engine recommends exposing to the LLM. Empty for engines that don't expose tools. */
  tools: Array<Tool>
  /** System prompt addition that explains when/how to use the tools. Empty when tools is empty. */
  toolGuidance: string
  raw: unknown
}

export interface RecallFragment {
  text: string
  source: string
}
```

The split between `systemPrompt` (canonical, always present) and `fragments`
(optional, for inspection and debug) is deliberate. Drivers that produce
discrete items populate both; drivers that produce synthesized text (like
Honcho's `peer.chat()` output) populate only `systemPrompt` and omit
`fragments`. The chat route reads `systemPrompt`; debug UI reads
`fragments` when present.

`source` on a fragment is a free-form provenance string. The composed
driver uses `` `${engineId}#${factId}` ``; Hindsight uses the result's
`type` or `id`; mem0 uses the memory id. Treat it as a label, not a
structured key.

### `RetainReceipt`

```ts
export interface RetainReceipt {
  engine: EngineId
  ok: boolean
  latencyMs: number
  raw: unknown
  error?: string
}
```

A receipt is always returned. Failures do not throw. `retainTurn` returns an
array because some drivers issue more than one underlying write per turn
(Hindsight retains user and assistant content separately and returns one
receipt per call).

### `MemorySnapshot`

```ts
export interface MemorySnapshot {
  engine: EngineId
  takenAt: string  // ISO-8601
  data: unknown
}
```

`data` is engine-specific. The UI rendering a snapshot is expected to be
engine-aware. Trying to normalize the shape would either flatten away
meaningful structure (Hindsight's bank profile, Honcho's queue status,
mem0's raw memory list) or impose an ontology the driver does not actually
use.

### `MemoryFact` and `FactList`

```ts
export interface MemoryFact {
  id: string
  text: string
  source?: string
  createdAt?: string
}

export interface FactList {
  engine: EngineId
  facts: Array<MemoryFact>
  takenAt: string
}
```

`MemoryFact` is the framework's lowest-common-denominator fact shape used by
`listFacts`. The bench UI renders the same column for every engine using
this type. `source` is a free-form label ("middleware", "tool", "observation",
"representation", …); the renderer treats it as a string, not an enum.

This is distinct from the richer `Fact` type used by the composition layer
(`tags`, `entities`, `metadata`, `supersededBy`, typed `createdAt: Date`).
See [`composition.md`](./composition.md). Composed drivers project from
`Fact` down to `MemoryFact` when answering `listFacts`.

## The tools/guidance pattern

Drivers may expose tools to the LLM. The pattern is:

- `recall()` returns the tool set it wants exposed for this turn.
- The chat route passes `tools` directly to the LLM call and concatenates
  `toolGuidance` into the system prompt.
- If the LLM invokes a tool, the tool's `execute` runs inside the driver's
  own logic, with access to whatever internal state it needs.
- The tool may call `scope.toolEvents?.onToolRetain` /
  `?.onToolRecall` so the chat route can record the tool-driven write
  alongside middleware writes.

Drivers that do not expose tools return `tools: []` and `toolGuidance: ''`.
This is always valid and is the canonical pattern for mem0 and Honcho (see
[`integrations.md`](./integrations.md)).

When a driver exposes both auto-recall (via the returned `systemPrompt`) and
tool-recall (via a tool the LLM can invoke), the LLM has two paths to
memory: automatic, and explicit. Both paths can fire in the same turn. The
driver is responsible for handling the resulting writes idempotently if
needed.

## Error handling

Three classes of error:

- **Recoverable per-operation failures** (network blip, transient API
  error): return `ok: false` in the receipt; do not throw. The chat route
  continues; the next turn retries naturally. For `recall`, return a
  `RecallResult` with `systemPrompt: ''` and (typically) `fragments: []` so
  the turn proceeds without memory rather than fails.
- **Configuration errors** (missing API key, invalid scope mapping): the
  shipped providers configure themselves from environment variables at
  import time and fail late, on the first call that hits the network. A
  user-written driver should prefer to throw at construction time so it
  cannot be constructed in a state that always fails.
- **Bugs** (unexpected null, invalid state): throw. These are not the chat
  route's problem to handle.

The contract requires the receipt shape; it does not require a particular
error class. Drivers are free to define their own.

## A minimal hand-rolled driver

A driver that wraps a hypothetical hosted service:

```ts
import type {
  MemoryDriver,
  Scope,
  RecallResult,
  RetainReceipt,
  RetainInput,
  MemorySnapshot,
  FactList,
  MemoryFact,
} from '@tanstack/ai-memory'

interface ExampleClient {
  store(args: { userId?: string; text: string }): Promise<{ id: string }>
  search(args: { userId?: string; query: string }): Promise<{
    memories: Array<{ id: string; text: string; score: number }>
  }>
  list(args: { userId?: string }): Promise<{
    memories: Array<{ id: string; text: string; created_at?: string }>
  }>
}

declare function makeExampleClient(apiKey: string): ExampleClient

export function createExampleDriver(opts: { apiKey: string }): MemoryDriver {
  const client = makeExampleClient(opts.apiKey)

  return {
    id: 'local', // pick an EngineId; widen the union if you need a new one

    async retainTurn(scope: Scope, input: RetainInput): Promise<Array<RetainReceipt>> {
      const start = Date.now()
      try {
        const result = await client.store({
          userId: scope.userId,
          text: `User: ${input.user}\nAssistant: ${input.assistant}`,
        })
        return [{
          engine: 'local',
          ok: true,
          latencyMs: Date.now() - start,
          raw: result,
        }]
      } catch (err: any) {
        return [{
          engine: 'local',
          ok: false,
          latencyMs: Date.now() - start,
          raw: null,
          error: err?.message ?? String(err),
        }]
      }
    },

    async recall(scope: Scope, query: string): Promise<RecallResult> {
      const start = Date.now()
      const result = await client.search({ userId: scope.userId, query })
      return {
        engine: 'local',
        latencyMs: Date.now() - start,
        systemPrompt: result.memories.map((m) => `- ${m.text}`).join('\n'),
        fragments: result.memories.map((m) => ({
          text: m.text,
          source: m.id,
        })),
        tools: [],
        toolGuidance: '',
        raw: result,
      }
    },

    async inspect(scope: Scope): Promise<MemorySnapshot> {
      const all = await client.list({ userId: scope.userId })
      return {
        engine: 'local',
        takenAt: new Date().toISOString(),
        data: all,
      }
    },

    async listFacts(scope: Scope): Promise<FactList> {
      const all = await client.list({ userId: scope.userId })
      const facts: Array<MemoryFact> = all.memories.map((m) => ({
        id: m.id,
        text: m.text,
        source: 'middleware',
        createdAt: m.created_at,
      }))
      return {
        engine: 'local',
        facts,
        takenAt: new Date().toISOString(),
      }
    },
  }
}
```

This is the entire surface. No abstract base class to extend, no decorators.
A driver is a plain object satisfying an interface.

## What this protocol intentionally does not specify

- **How retain decides what to store.** Some drivers store raw text; some
  extract atomic facts; some build entity graphs. All conform.
- **How recall ranks or filters.** Some drivers do vector search; some do
  graph traversal; some call a remote synthesis endpoint. All conform.
- **Whether memory persists across sessions.** Scope-mapping is the
  driver's responsibility. A driver scoped per-session and a driver scoped
  per-user are both valid.
- **What `inspect` returns.** The UI consuming inspect is expected to be
  engine-aware. Trying to normalize the shape would either flatten away
  meaningful structure or impose an ontology the driver does not actually
  use.
- **The exact `MemoryFact.source` vocabulary.** `listFacts` returns a
  string; drivers pick the labels that make sense for their provenance
  model.

These are not gaps. They are the surface area where drivers differ from each
other, and the protocol's job is to stay out of those decisions.
