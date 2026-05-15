# @tanstack/ai-memory

A protocol for AI agent memory, plus shipped integrations for hosted memory
services and a composition kit for building your own driver.

The package itself is small. Most of it is types. The work is done by:

- **Providers** — concrete implementations of the `MemoryDriver` contract.
  The package ships providers for Hindsight, mem0, and Honcho. You can write
  your own.
- **Stages** — interfaces (`Extractor`, `Consolidator`, `Renderer`,
  `FactStore`, `Embedder`) used by `createComposedDriver` when you want to
  build a driver from parts instead of wrapping a service. The package
  defines the interfaces and the factory; it does not ship reference
  implementations of any stage.

The example app at [`apps/web`](../../apps/web) contains working stage
implementations (SQLite-backed `FactStore`, OpenAI-backed `Embedder`,
Anthropic-backed `Extractor`, a simple consolidator, and a bullet renderer)
intended to be copied and adapted rather than imported as a dependency.

## Package layout

```text
@tanstack/ai-memory
├── src/index.ts             MemoryDriver, Scope, RetainInput, RetainReceipt,
│                            RecallResult, RecallFragment, MemorySnapshot,
│                            MemoryFact, FactList, EngineId, MemoryToolEventSink
├── src/types/stages.ts      Fact, CandidateFact, FactQuery, FactFilter,
│                            FactStore, Embedder, Extractor, ExtractContext,
│                            Consolidator, ConsolidationDecision, Renderer,
│                            ToolFactory
├── src/factory.ts           createComposedDriver, ComposedDriverConfig
├── src/utils.ts             applyConsolidationDecisions
└── src/providers/
    ├── hindsight/index.ts   hindsightEngine, makeHindsightTools,
    │                        bankIdFor, resetHindsightBank
    ├── hindsight/tools.ts   hindsight_retain / _recall / _reflect tool defs
    ├── mem0/index.ts        mem0Engine, resetMem0User
    └── honcho/index.ts      honchoEngine, resetHonchoWorkspace,
                             parseHonchoRepresentationToFacts
```

No SQLite, no model providers, no embeddings code in the protocol layer. The
provider modules import their respective vendor SDKs and nothing else.

## Subpath exports

Provider drivers are imported from subpaths so that each vendor SDK is only
pulled into the bundle when you use that provider:

```ts
import { hindsightEngine } from '@tanstack/ai-memory/hindsight'
import { mem0Engine }      from '@tanstack/ai-memory/mem0'
import { honchoEngine }    from '@tanstack/ai-memory/honcho'
```

Each subpath maps to `src/providers/<name>/index.ts` (see
[`package.json`](./package.json) `exports`).

## Quick start

Pick a provider, register it, talk to it through the `MemoryDriver` contract:

```ts
import { hindsightEngine } from '@tanstack/ai-memory/hindsight'
import type { MemoryDriver, Scope } from '@tanstack/ai-memory'

const driver: MemoryDriver = hindsightEngine
const scope: Scope = { sessionId: 's-1', userId: 'demo-user' }

const recall = await driver.recall(scope, 'what should I avoid prescribing?')
// recall.systemPrompt: string  -> concatenate into the LLM system prompt
// recall.tools:        Tool[]  -> hand to the LLM
// recall.toolGuidance: string  -> append to system prompt when tools is non-empty

await driver.retainTurn(scope, {
  user: "I'm allergic to penicillin.",
  assistant: 'Got it, noted.',
})

const snapshot = await driver.inspect(scope)
const facts = await driver.listFacts(scope)
```

To build a driver from parts instead of wrapping a hosted service, see
[`docs/composition.md`](./docs/composition.md) and the worked example in
[`apps/web/src/memory/drivers/local.ts`](../../apps/web/src/memory/drivers/local.ts).

## Docs

- [`docs/protocol.md`](./docs/protocol.md) — the `MemoryDriver` contract. The
  one thing anyone implementing a driver must satisfy. Read this first.
- [`docs/integrations.md`](./docs/integrations.md) — the shipped vendor
  providers (Hindsight, mem0, Honcho). Configuration, scope mapping, tools.
- [`docs/composition.md`](./docs/composition.md) — building your own driver
  from stages with `createComposedDriver`. Stage interfaces, lifecycle, and a
  pointer to the reference stage implementations in `apps/web`.
- [`docs/scope.md`](./docs/scope.md) — memory types this framework
  addresses, and what it deliberately leaves to the agent or to other
  systems.

## Versioning and peer dependencies

Vendor SDKs are pulled in by the provider modules: Hindsight via
`@vectorize-io/hindsight-client`, Honcho via `@honcho-ai/sdk`, and mem0 via
direct HTTP `fetch` against its REST API (no SDK). The provider singletons
are pre-configured from environment variables at import time
(`HINDSIGHT_URL`, `MEM0_URL`, `MEM0_ADMIN_API_KEY`, `HONCHO_URL`,
`HONCHO_API_KEY`, `HONCHO_APP_NAME`); see
[`docs/integrations.md`](./docs/integrations.md) for the full list.

If a provider integration grows complex enough to warrant its own publish
cadence — or if a vendor wants to own the integration — that provider moves
to its own package. The trigger is real need, not anticipated need.
