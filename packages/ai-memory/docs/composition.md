# composition.md

For when you want to build a `MemoryDriver` from parts instead of wrapping a
hosted service.

`@tanstack/ai-memory` defines four pipeline stages — `Extractor`,
`Consolidator`, `Renderer`, `FactStore` — plus an `Embedder` convenience
interface, and a `createComposedDriver` factory that wires them into a
driver satisfying [`protocol.md`](./protocol.md). **The package defines the
interfaces and the factory only. It does not ship reference implementations
of any stage.** Working implementations live in the example app and are
intended to be copied and adapted, not imported as dependencies.

This separation is deliberate. The interfaces are universal. The
implementations are opinionated (which model? which storage? which
extraction prompt?) and those opinions belong with the app that holds them,
not the framework that defines the contract.

All type signatures below are copy-pasted from
[`src/types/stages.ts`](../src/types/stages.ts) and
[`src/factory.ts`](../src/factory.ts). The code is the source of truth.

## When to compose vs wrap

Compose when:

- You want memory backed by your own database, with your own retrieval
  strategy.
- You want to experiment with extraction or consolidation logic.
- No hosted service fits your privacy, cost, or behavior requirements.
- You're writing a new memory system and want the protocol scaffolding for
  free.

Wrap when:

- A hosted service does what you need. See
  [`integrations.md`](./integrations.md).

Both approaches produce a `MemoryDriver`. The chat route does not
distinguish.

## The four stages

```ts
export interface Extractor {
  extract(text: string, ctx?: ExtractContext): Promise<Array<CandidateFact>>
}

export interface Consolidator {
  consolidate(
    scope: Scope,
    candidates: Array<CandidateFact>,
    store: FactStore,
  ): Promise<Array<ConsolidationDecision>>
}

export interface Renderer {
  render(facts: Array<Fact>): string
}

export interface FactStore<F extends Fact = Fact> {
  storeFact(scope: Scope, fact: F): Promise<void>
  getFact(scope: Scope, id: string): Promise<F | null>
  searchFacts(scope: Scope, query: FactQuery): Promise<Array<F>>
  listFacts(scope: Scope, filter?: FactFilter): Promise<Array<F>>
  deleteFact(scope: Scope, id: string): Promise<void>
}
```

A fifth interface, `Embedder`, is defined for convenience but is not part of
the pipeline directly. Stages that need embeddings take an `Embedder` in
their own constructor:

```ts
export interface Embedder {
  embed(texts: Array<string>): Promise<Array<Float32Array>>
}
```

The reference SQLite store, for example, takes an `Embedder` so it can
embed `query.text` for KNN; the composed driver does not see the embedder
at all.

### What each stage is responsible for

**`Extractor`** turns conversational text into a set of atomic candidate
facts. The composed driver calls `extract` once per turn with the string
`` `User: ${input.user}\nAssistant: ${input.assistant}` ``; the extractor
decides what to make of it. The reference Anthropic extractor uses Claude
Haiku to pull durable, self-contained statements; an extractor for a
different domain might use regex, a different model, or a different prompt.
The interface does not care.

**`Consolidator`** decides what to do with candidate facts given the
existing fact store. For each candidate it produces a decision: insert as a
new fact, merge with an existing fact, supersede an existing fact, or skip.
The consolidator is given the store and is expected to query it (via
`searchFacts`) to find similar existing facts. The consolidator decides,
but does not execute — it returns decisions, and the composed driver
applies them via `applyConsolidationDecisions`.

**`Renderer`** turns a list of facts into a string suitable for an LLM
system prompt. The renderer is pure — no I/O, just formatting. The
reference bullet renderer produces

```text
Recalled memory:
- (id) text
- (id) text
```

and returns an empty string when given no facts.

**`FactStore`** persists facts and answers queries about them.
`searchFacts` accepts a `FactQuery` and returns matching facts; how
matching is determined is the store's business. A simple SQLite store
might match on `LIKE`; a vector store might embed and KNN; a hybrid store
might fuse multiple strategies. The interface does not prescribe.

## Data types

### `Fact` and `CandidateFact`

```ts
export interface CandidateFact {
  text: string
  tags?: Array<string>
  entities?: Array<string>
  metadata?: Record<string, unknown>
}

export interface Fact extends CandidateFact {
  id: string
  createdAt: Date
  supersededBy?: string
}
```

A `CandidateFact` is what an extractor produces. A `Fact` is what a store
persists. The difference is identity and time.

Both shapes are generic over their own extensions. A consolidator that
produces facts with evidence chains, a renderer that uses tag taxonomies,
or a store that embeds custom fields — these can all extend the base
types. The composed driver is parameterized over the fact type:

```ts
export function createComposedDriver<F extends Fact = Fact>(
  config: ComposedDriverConfig<F>,
): MemoryDriver
```

In practice, most users start with the base `Fact` and only extend when a
specific extension proves necessary.

### `FactQuery` and `FactFilter`

```ts
export interface FactQuery {
  text?: string
  filter?: FactFilter
  limit?: number
  hints?: Record<string, unknown>
}

export interface FactFilter {
  tags?: Array<string>
  entities?: Array<string>
  createdAfter?: Date
  createdBefore?: Date
  includeSuperseded?: boolean
}
```

The `text` field is intentionally untyped beyond "free text." A `FactQuery`
does not specify *how* to find — vector, lexical, graph, hybrid are all
store decisions. The `hints` field exists for the case where a caller has
store-specific knowledge and wants to influence behavior; stores that don't
recognize a hint should ignore it.

`includeSuperseded` defaults to `false` (active facts only). The reference
SQLite store applies this default in `listFacts` and additionally drops
superseded rows from `searchFacts` results unconditionally.

### `ConsolidationDecision`

```ts
export type ConsolidationDecision =
  | { action: 'insert'; fact: CandidateFact }
  | { action: 'merge'; existingId: string; merged: CandidateFact }
  | { action: 'supersede'; existingId: string; replacement: CandidateFact }
  | { action: 'skip'; candidate: CandidateFact; reason: string }
```

Four actions are sufficient for the consolidation patterns the framework
supports:

- **`insert`** — the candidate is new; store it as a fresh fact.
- **`merge`** — the candidate adds information to an existing fact; replace
  the existing fact's content with the merged version (same id retained).
- **`supersede`** — the candidate replaces an existing fact; the existing
  one is marked superseded and a new replacement fact is created. The
  reference consolidator uses this for LLM-flagged "merge" decisions so the
  old row is preserved as history.
- **`skip`** — the candidate is redundant or low-quality; do nothing.

The framework provides `applyConsolidationDecisions(store, scope, decisions)`
as a utility that executes decisions against any `FactStore`. Most composed
drivers will use this directly rather than reimplementing it; the composed
driver does so on every `retainTurn`.

The exact behavior is:

```ts
export async function applyConsolidationDecisions<F extends Fact = Fact>(
  store: FactStore<F>,
  scope: Scope,
  decisions: Array<ConsolidationDecision>,
): Promise<void>
```

- `insert` → `store.storeFact(scope, { ...fact, id: crypto.randomUUID(), createdAt: new Date() })`.
- `merge` → fetch existing, shallow-merge the candidate over it, store.
- `supersede` → store a new replacement fact, then write the existing one
  back with `supersededBy: replacement.id`.
- `skip` → no-op.

If the consolidator references an `existingId` that no longer exists, the
helper silently skips that decision.

## The factory

```ts
export interface ComposedDriverConfig<F extends Fact = Fact> {
  id: EngineId
  store: FactStore<F>
  extractor: Extractor
  consolidator: Consolidator
  renderer: Renderer
  tools?: ToolFactory<F>
  toolGuidance?: string
  recallLimit?: number
}

export function createComposedDriver<F extends Fact = Fact>(
  config: ComposedDriverConfig<F>,
): MemoryDriver
```

```ts
export type ToolFactory<F extends Fact = Fact> = (ctx: {
  scope: Scope
  store: FactStore<F>
}) => Array<Tool>
```

The factory wires the stages and returns an object satisfying
`MemoryDriver`. The optional `tools` and `toolGuidance` parameters let
composed drivers participate in the same tool-augmented pattern Hindsight
uses; omit them for pure middleware behavior.

`recallLimit` controls how many facts `searchFacts` is asked for during
recall. Default: `8`.

`id` must be a valid `EngineId`. If you need a new id, widen the union in
[`src/index.ts`](../src/index.ts).

## Lifecycle inside a composed driver

When the chat route calls `driver.retainTurn(scope, input)`:

```text
1. text       = `User: ${input.user}\nAssistant: ${input.assistant}`
2. candidates = await extractor.extract(text, { scope })
3. decisions  = await consolidator.consolidate(scope, candidates, store)
4. await applyConsolidationDecisions(store, scope, decisions)
5. return [{ engine: id, ok: true, latencyMs, raw: { candidates, decisions } }]
```

Errors in any stage are caught at the driver boundary and converted into a
single `RetainReceipt` with `ok: false` and the error message — the call
never throws.

When the chat route calls `driver.recall(scope, query)`:

```text
1. tools     = config.tools ? config.tools({ scope, store }) : []
2. facts     = await store.searchFacts(scope, { text: query, limit: recallLimit })
3. return {
     engine: id, latencyMs,
     systemPrompt: renderer.render(facts),
     fragments: facts.map(f => ({ text: f.text, source: `${id}#${f.id}` })),
     tools,
     toolGuidance: config.toolGuidance ?? '',
     raw: { facts },
   }
```

Errors during recall return a `RecallResult` with an empty `systemPrompt`
and empty `fragments`, still carrying the tools (so the LLM can still call
them) and the error on `raw.error`.

When the chat route calls `driver.inspect(scope)`:

```text
1. facts      = await store.listFacts(scope, { includeSuperseded: true })
2. active     = facts.filter(f => !f.supersededBy)
3. superseded = facts.filter(f => f.supersededBy)
4. return MemorySnapshot with data = {
     memories: active.map(...),         // id, content, source, createdAt, tags, entities
     supersededCount: superseded.length,
     supersededChains: superseded.map(...) // id, content, supersededBy
   }
```

When the chat route calls `driver.listFacts(scope)`:

```text
1. facts = await store.listFacts(scope)   // default: active only
2. return FactList with facts.map(f => ({
     id: `${id}-${f.id}`,
     text: f.text,
     source: (f.metadata?.source as string) ?? 'middleware',
     createdAt: f.createdAt.toISOString(),
   }))
```

The lifecycle is deliberately straightforward. A composed driver is not the
place for clever orchestration; clever orchestration lives in the stages.

## A worked example

The local driver in the example app composes the five reference stages.
This is the complete file at
[`apps/web/src/memory/drivers/local.ts`](../../../apps/web/src/memory/drivers/local.ts),
abbreviated:

```ts
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'

import {
  createComposedDriver,
  type MemoryDriver,
  type Scope,
} from '@tanstack/ai-memory'

import { createAnthropicExtractor } from '../stages/anthropic-extractor'
import { createBulletRenderer }     from '../stages/bullet-list-renderer'
import { createOpenAIEmbedder }     from '../stages/openai-embedder'
import { createSimpleConsolidator } from '../stages/simple-consolidator'
import { createSqliteFactStore }    from '../stages/sqlite-fact-store'

export function createLocalDriver(opts: CreateLocalDriverOptions = {}): MemoryDriver {
  const openaiApiKey    = opts.openaiApiKey    ?? process.env.OPENAI_API_KEY ?? ''
  const anthropicApiKey = opts.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? ''

  const embedder = createOpenAIEmbedder({
    apiKey: openaiApiKey,
    model: opts.embeddingModel,            // default: text-embedding-3-small
  })

  const store = createSqliteFactStore({
    getDb: (scope: Scope) => getLocalSessionDb(scope.sessionId),
    embedder,
    similarityThreshold: opts.similarityThreshold ?? 0.75,
  })

  const extractor = createAnthropicExtractor({
    apiKey: anthropicApiKey,
    model: opts.extractionModel,           // default: claude-haiku-4-5
  })

  const consolidator = createSimpleConsolidator({
    apiKey: anthropicApiKey,
    model: opts.extractionModel,
    searchLimit: opts.searchLimit ?? 5,
    similarityThreshold: opts.similarityThreshold ?? 0.75,
  })

  return createComposedDriver({
    id: 'local',
    store,
    extractor,
    consolidator,
    renderer: createBulletRenderer({ idPrefix: 'local' }),
    recallLimit: opts.recallLimit ?? 8,
  })
}
```

This composition produces a driver functionally equivalent to what the
package previously shipped as TanMemory. Every decision — model choice,
similarity threshold, search limit, embedding provider — is visible at the
composition site rather than hidden inside the package.

Two implementation notes worth surfacing for stage authors:

**The store takes `getDb`, not `db`.** TanMemory uses one SQLite file per
`sessionId`, so the store needs to resolve the right database per call
rather than be bound to a single connection. The reference store keeps a
schema-applied `WeakSet<Database>` so each file is only initialized once
per process.

**The similarity gate lives on the consolidator.** The reference SQLite
store annotates each returned `Fact`'s `metadata.similarity` (computed
from sqlite-vec's L2 distance via the embedder module's
`l2DistanceToSimilarity`). The consolidator reads `metadata.similarity`
from neighbors and short-circuits to `insert` without calling the LLM when
the best neighbor scores below `similarityThreshold` (default `0.75`).
Stores that don't populate `metadata.similarity` cause the consolidator to
always consult the LLM.

## Reference stage implementations

The example app contains working implementations of each stage. Each file
is self-contained: imports only from `@tanstack/ai-memory` for types and
from its own npm dependencies. Each is intended to be copied into another
project and modified rather than imported as a library.

| File | What it implements |
|------|--------------------|
| [`apps/web/src/memory/stages/sqlite-fact-store.ts`](../../../apps/web/src/memory/stages/sqlite-fact-store.ts) | `FactStore` backed by SQLite + sqlite-vec, with vector similarity for `searchFacts(text)`. Schema: `tanmemory_memories(id, content, source, tags, entities, metadata, created_at, updated_at, superseded_by)` and `tanmemory_vec(memory_id, embedding FLOAT[1536])`. |
| [`apps/web/src/memory/stages/openai-embedder.ts`](../../../apps/web/src/memory/stages/openai-embedder.ts) | `Embedder` calling OpenAI's `text-embedding-3-small` (1536-dim). Also exports `toVecBuffer` and `l2DistanceToSimilarity` helpers for SQLite-vec interop. |
| [`apps/web/src/memory/stages/anthropic-extractor.ts`](../../../apps/web/src/memory/stages/anthropic-extractor.ts) | `Extractor` using Claude Haiku (`claude-haiku-4-5` default) to pull atomic facts as `{ facts: string[] }`. |
| [`apps/web/src/memory/stages/simple-consolidator.ts`](../../../apps/web/src/memory/stages/simple-consolidator.ts) | `Consolidator` that searches the store for similar facts and uses Claude Haiku to choose `insert`/`merge`/`skip` — with LLM `merge` decisions translated to `supersede` so the old row is preserved. Skips the LLM when the best similarity is below `0.75`. |
| [`apps/web/src/memory/stages/bullet-list-renderer.ts`](../../../apps/web/src/memory/stages/bullet-list-renderer.ts) | `Renderer` producing `Recalled memory:\n- (prefix#id) text` per fact. Returns `''` when given no facts. |

The schema table names (`tanmemory_memories`, `tanmemory_vec`) are
preserved verbatim from the legacy TanMemory implementation so existing
on-disk databases keep working through the refactor.

## Notes for stage authors

A few things to internalize when writing your own stage implementation:

**Stages compose through the store, not through each other.** The
extractor does not know about the consolidator. The consolidator does not
know how the store finds similar facts. Each stage produces output the
next stage consumes, mediated by the store. Keep stage interfaces narrow.

**The consolidator's similarity decisions are partly the store's.** When a
consolidator calls `store.searchFacts({ text: candidate.text })`, the
store decides what "similar" means. A consolidator written against a
vector-search store will behave differently against a lexical-search
store. The reference consolidator additionally reads
`metadata.similarity` from results and relies on the store populating it
for the cheap-path gate. This is not a bug; it is the point of the
abstraction. Document your consolidator's assumptions about the store.

**The renderer should never call into the store.** Rendering is pure
formatting on a fact list the driver has already retrieved. A renderer
that fetches more facts is doing recall, and recall is the driver's
responsibility, not the renderer's.

**Stage failures should propagate.** Unlike the driver-level operations
(which return receipts), stages can throw. The composed driver catches
stage errors at the driver boundary and converts them into a
`RetainReceipt` with `ok: false` (for `retainTurn`) or an empty
`RecallResult` with the error on `raw.error` (for `recall`). Stage
authors do not need to handle this themselves.
