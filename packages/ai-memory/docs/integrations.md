# integrations.md

The vendor memory providers shipped with `@tanstack/ai-memory`.

Each provider wraps a third-party memory service in the `MemoryDriver`
contract defined in [`protocol.md`](./protocol.md). Providers are imported
from subpaths so that the SDK each one depends on is only pulled into your
bundle if you actually use that provider:

```ts
import { hindsightEngine } from '@tanstack/ai-memory/hindsight'
import { mem0Engine }      from '@tanstack/ai-memory/mem0'
import { honchoEngine }    from '@tanstack/ai-memory/honcho'
```

## Configuration model

Unlike the composed driver, the shipped providers are **pre-configured
singletons** rather than factories. Each provider module reads environment
variables once, at import time, and exports a single `MemoryDriver` value:

| Provider     | Exported driver   | Module                                         |
|--------------|-------------------|------------------------------------------------|
| Hindsight    | `hindsightEngine` | [`src/providers/hindsight/index.ts`](../src/providers/hindsight/index.ts) |
| mem0         | `mem0Engine`      | [`src/providers/mem0/index.ts`](../src/providers/mem0/index.ts) |
| Honcho       | `honchoEngine`    | [`src/providers/honcho/index.ts`](../src/providers/honcho/index.ts) |

To use a provider you set the relevant env vars before the module is
imported. To change configuration in the same process, fork the provider
module — there is no per-driver config API.

If you want a different configuration model (e.g. multiple instances with
different keys in one process), wrap the SDK yourself behind the
`MemoryDriver` contract. The provider modules are short and exist to be
copied if needed.

## Hindsight

Persistent agent memory built around three operations: retain, recall, and
reflect. The Hindsight provider wraps the official client
(`@vectorize-io/hindsight-client`) and exposes Hindsight in its documented
"full setup" pattern: middleware retain/recall plus three LLM-callable
tools.

### Environment variables

```bash
HINDSIGHT_URL  # default: http://localhost:8888
```

The Hindsight client supplied with the bench does not currently take an API
key; deployments needing auth wrap the SDK with their own client and rebind
the export.

### Scope mapping

Hindsight banks are session-bucketed: each conversation gets an isolated
bank. The bank id is `` `${userId}__${sessionId}` ``, falling back to
`demo-user` when `scope.userId` is missing. This is wired up by
`bankIdFor(scope)` in
[`src/providers/hindsight/index.ts`](../src/providers/hindsight/index.ts).

This is more aggressive isolation than mem0's user-id scoping or Honcho's
durable peer; if you want cross-session memory inside Hindsight you'll need
to fork the provider and change the bank id strategy.

### What the driver does

- `recall(scope, query)`: calls
  `client.recall(bankId, query, { budget: 'mid' })`. The systemPrompt is
  produced by the SDK helper `recallResponseToPromptString`; fragments are
  built from the response's `results` (one per recalled item, with
  `source = r.type ?? r.id`). Three tools and the canonical guidance text
  are returned with every recall.
- `retainTurn(scope, input)`: fires two parallel `client.retain` calls, one
  for the user message (`context: 'chat:user'`) and one for the assistant
  reply (`context: 'chat:assistant'`), both tagged with the same
  `timestamp`. Returns two receipts.
- `inspect(scope)`: calls `client.listMemories(bankId, { limit: 200 })` and
  `client.getBankProfile(bankId)` in parallel and returns both under
  `data.memories` and `data.profile`. Failed calls land as
  `{ error: '...' }` rather than throwing.
- `listFacts(scope)`: maps `client.listMemories` items to `MemoryFact`.
  Source resolution walks `context` → `fact_type` → `type` → `'unknown'`,
  with `chat:user`/`chat:assistant` collapsed to `'middleware'` and
  `chat:tool` mapped to `'tool'`.

A helper, `resetHindsightBank(userId, sessionId)`, is also exported for
tests and the bench reset endpoint.

### Tools exposed

The LLM sees three tools (defined in
[`src/providers/hindsight/tools.ts`](../src/providers/hindsight/tools.ts)):

- `hindsight_retain(content)`: store a fact, decision, or context the model
  identifies as important to remember.
- `hindsight_recall(query)`: query memory directly. Useful when the model
  needs context not surfaced by the automatic recall.
- `hindsight_reflect(question)`: synthesize across many memories to answer a
  question. Routes to Hindsight's reflect endpoint, which applies
  mission/directives/disposition reasoning.

The guidance string is defined in the provider module and scopes when each
tool should be used. Tool executions fire `scope.toolEvents?.onToolRetain`
and `onToolRecall` so the orchestrator can record tool-driven writes
distinctly from middleware writes.

### Notes

- Hindsight's pipeline dedups retain calls internally. If the LLM invokes
  `hindsight_retain` for a fact that middleware retain also captures, both
  writes are absorbed into a single consolidated observation.
- Reflect calls are more expensive than retain or recall (they involve full
  memory traversal and synthesis). The guidance text scopes their use to
  genuine synthesis questions to avoid over-invocation.

## mem0

Memory-as-a-service with synchronous extraction inside the retain call. The
mem0 provider talks to mem0's REST API directly (`fetch`, no SDK) and
exposes mem0 in its canonical pattern: middleware-only, no tools.

### Environment variables

```bash
MEM0_URL              # default: http://localhost:8000
MEM0_ADMIN_API_KEY    # optional; sent as `Authorization: Bearer ...` when set
```

### Scope mapping

mem0 memories are addressed by `user_id` only. The provider falls back to
`'demo-user'` when `scope.userId` is missing. Sessions are not used; every
session for a given user reads and writes the same mem0 user scope.

### What the driver does

- `recall(scope, query)`: `POST /search` with
  `{ query, user_id, rerank: true, threshold: 0.1 }`. Returns the memory
  list rendered as a bulleted block (`- (id) text`) in `systemPrompt`, each
  memory as a fragment, and empty `tools` / `toolGuidance`. If `/search`
  returns non-OK or no items, `systemPrompt` is empty.
- `retainTurn(scope, input)`: `POST /memories` with both user and
  assistant content as a two-message conversation
  (`[{ role: 'user', content }, { role: 'assistant', content }]`) plus
  `user_id`. mem0's LLM-based extractor runs synchronously inside this
  call. Returns a single receipt.
- `inspect(scope)`: `GET /memories?user_id=...` and returns the parsed
  body as `data`.
- `listFacts(scope)`: same endpoint as `inspect`; maps items to
  `MemoryFact` (`source: 'memory'`, `createdAt` from `updated_at` or
  `created_at`).

A helper, `resetMem0User(userId)`, is also exported. It tries the bulk
delete endpoint first and falls back to per-id deletes if bulk fails.

### Tools exposed

None. mem0 has a tools API but does not document it as the canonical
pattern. The provider exposes mem0 in its documented middleware shape. If
you want tool-based mem0 control, write a custom driver or wrap this one.

## Honcho

Identity and memory layer organized around peers, sessions, and a dialectic
synthesis API. The Honcho provider wraps `@honcho-ai/sdk` and exposes
Honcho in its canonical pattern: middleware-only, with `peer.chat()`
providing the recall synthesis.

### Environment variables

```bash
HONCHO_URL            # default: http://localhost:8001
HONCHO_APP_NAME       # workspace id, default: ai-memory
HONCHO_API_KEY        # default: 'dev-no-auth' when unset
```

### Scope mapping

Honcho's identity model is workspace + peer + session. The provider maps:

- workspace: `HONCHO_APP_NAME` (configured at module load)
- user peer: `scope.userId` (falls back to `'demo-user'`)
- assistant peer: a singleton `'assistant'` peer
- session: `scope.sessionId`

Knowledge accumulates on the user peer and persists across sessions
automatically — this is Honcho's design, not configurable per call.

The provider maintains module-level caches for the user-peer, assistant-peer,
and session promises so repeated calls reuse the same SDK handles.

### What the driver does

- `recall(scope, query)`: calls `userPeer.chat(query, { session })`.
  Returns the synthesized dialectic paragraph as `systemPrompt`. Honcho's
  output is synthesized, not discrete, so `fragments` is **omitted** (not
  `[]`). Tools and guidance are empty.
- `retainTurn(scope, input)`: calls
  `session.addMessages([userPeer.message(user), assistantPeer.message(assistant)])`.
  Honcho's deriver consolidates asynchronously (typically within ~10
  seconds — long enough that the bench uses a longer snapshot delay for
  Honcho).
- `inspect(scope)`: returns `data.messages` (last 50), `data.queueStatus`,
  and `data.summaries`, each running in parallel.
- `listFacts(scope)`: calls `userPeer.representation()` and parses the
  returned text via `parseHonchoRepresentationToFacts`. The parser strips
  headings and the "Explicit Observations" preamble, then extracts
  `[timestamp] text` rows. `conclusions.list()` is intentionally **not**
  used — in practice it surfaces noisy meta lines rather than contentful
  preferences.

A helper, `resetHonchoWorkspace()`, deletes all sessions and then deletes
the workspace itself; useful for the bench reset endpoint.

### Tools exposed

None. Honcho's API surface is middleware-shaped by design — `peer.chat()`
exists specifically to return text suitable for a system prompt. Tool
exposure is not part of the canonical pattern.

### Notes

- Because the deriver is async, facts retained on turn N may not appear in
  `inspect()` or `listFacts()` results for several seconds. Tests and
  demos should account for this.
- Workspace isolation is logical, not physical. If you run multiple apps
  against one Honcho instance, give each a distinct `HONCHO_APP_NAME`.

## Provider selection

These three providers represent three different stances:

| Provider   | What you're choosing |
|------------|----------------------|
| Hindsight  | Structured observation memory with first-class reflect. Tools-augmented middleware as the documented default. |
| mem0       | Lightweight extracted-fact memory. Middleware-first, synchronous extraction, simple ontology. |
| Honcho     | Identity-centered memory with dialectic synthesis. Persistent peer knowledge, async derivation. |

The framework does not rank them. The choice is yours and depends on what
your application's "memory" actually means.

If none of these fit — or you want to experiment with a memory system that
doesn't exist as a hosted service — see [`composition.md`](./composition.md)
for how to build your own driver from stages.
