# memory-bench — status

## What "working" means (2026-05-14)

Four memory engines — **Hindsight**, **mem0**, **Honcho**, and **TanMemory** — run side-by-side on **`/`** (the only primary UI route). All implement the same `MemoryDriver` interface (`src/lib/memory/types.ts`). Each turn:

1. **Recall** — Before the model streams, `runRecallForTurn(sessionId, activeEngineId, latestUserText)` calls the active driver's `recall()`. The driver returns a `RecallResult` with a pre-rendered `systemPrompt` block (in the engine's native shape), optional discrete `fragments` for the debug strip, an array of `tools` to expose to the LLM, and a `toolGuidance` string. The chat route concatenates `BASE_SYSTEM_PROMPT + toolGuidance + systemPrompt` and passes `tools` straight to `@tanstack/ai-anthropic`. **No engine-id branching anywhere in the route.**
2. **Retain** — After the assistant finishes, `memory-retain` middleware `ctx.defer`s `runTurn(...)` so user + assistant text is written to SQLite and fanned out to every enabled engine without blocking SSE start.
3. **Tool retains/recalls** — If the active engine exposes tools and the LLM calls one mid-stream, the tool's `execute` pushes an event into `tool-event-buffer.ts`. `runTurn` drains the buffer after creating the turn row and writes those events to SQLite with `source: 'tool'` (vs `source: 'middleware'` for the post-stream fan-out).
4. **Facts panel** — Each column polls `GET /api/memory/{engine}/facts?sessionId=...` every **2s** via `useIntervalPolling` (stable deps: `engineId` + `sessionId` only). Scrub mode passes server-loaded `data` and does not poll.

### Engine-specific behavior

| Engine | Retain (`retainTurn`) | Recall | Facts (`listFacts`) | Tools | Scope |
|--------|---------------------|--------|----------------------|--------|--------|
| **Hindsight** | Two `retain(bankId, …)` calls (`chat:user` / `chat:assistant`). | `client.recall(bankId, query, { budget: 'mid' })` → `recallResponseToPromptString` for systemPrompt. | `client.listMemories(bankId)`. | `hindsight_retain` / `_recall` / `_reflect` | `userId__sessionId` (session-bucketed) |
| **mem0** | `POST /memories` with `[user, assistant]` + `user_id`. | `POST /search` with `rerank: true`, `threshold: 0.1`, `user_id`. systemPrompt is the `- (id) text` list. | `GET /memories?user_id=...`. | (none — middleware is mem0's canonical pattern) | `user_id` only — survives session rotation |
| **Honcho** | `session.addMessages([userPeer, assistantPeer])`; deriver async. | `userPeer.chat(query, { session })` → synthesized paragraph as `systemPrompt` (fragments omitted — synthesized output has no discrete items). | `userPeer.representation()` → parsed bullets. | (none) | Workspace + peer; knowledge persists across sessions |
| **TanMemory** | Haiku extracts atomic facts → embed (OpenAI `text-embedding-3-small`) → KNN top-5 against `tanmemory_vec` → if cosine ≥ 0.75, Haiku decides insert/merge/skip. Soft-delete via `supersededBy`. | Embed query → KNN top-8 → render as `- (tanmemory#id) text`. | Active rows from `tanmemory_memories`. | `tanmemory_retain` / `_recall` / `_reflect` | Per-session SQLite + `sqlite-vec` virtual table |

### Driver interface

`MemoryDriver.recall()` returns a `RecallResult` with these fields:

- `systemPrompt: string` — pre-rendered block ready to drop into the LLM system prompt. Always present (empty string is the off-state).
- `fragments?: Array<RecallFragment>` — discrete items when the engine produces them. Optional. Honcho omits it (synthesized output has no discrete items).
- `tools: Array<Tool>` — TanStack AI tool definitions. Empty array is the off-state.
- `toolGuidance: string` — system-prompt addition explaining when/how to use the tools. Empty string when `tools` is empty.
- `raw: unknown` — engine-native payload for the inspector.

This shape replaced the old `{ fragments, raw }` shape in commit `7ca8b9a`. Driver-side rendering and tool exposure moved into each driver so the chat route stays uniform.

### Chat route

- [`src/routes/api.chat.ts`](src/routes/api.chat.ts) — reads `body.data.{sessionId, engineId}` (TanStack AI nesting), calls the active driver's `recall()`, composes the system prompt, passes `tools` to `chat({...})`, and registers the `memory-retain` middleware. Optional logging via `DEBUG_CHAT=1`.
- [`src/server/memory/orchestrator.ts`](src/server/memory/orchestrator.ts) — `runRecallForTurn`, `runTurn` (drains the tool-event buffer + writes retains/recalls with the appropriate `source`), pre/post snapshots.

### SQLite schema

Per-session SQLite at `data/sessions/<sessionId>.sqlite`. Tables: `session_meta`, `turns`, `retains`, `recalls`, `snapshots`, `tanmemory_memories`, plus the `tanmemory_vec` virtual table (sqlite-vec `vec0`, `FLOAT[1536]`).

- `retains.source` and `recalls.source` are nullable `text` columns with `'middleware' | 'tool'` enum constraint (added in migration `0001_gifted_groot`). Historical rows pre-migration are NULL and treated as middleware by the UI.
- `tanmemory_memories` (added in migration `0002_common_deadpool`) has `supersededBy` for the consolidation chain. Active memories are `supersededBy IS NULL`.
- `tanmemory_vec` is created via raw `CREATE VIRTUAL TABLE IF NOT EXISTS` in `applyMigrations()` because drizzle can't model vec0 virtual tables. The sqlite-vec extension is loaded on every connection in `sessionDb.ts`.

### UI

- [`src/routes/index.tsx`](src/routes/index.tsx) — full-viewport memory bench (chat + four facts columns). Engine selector shows all four. Reset confirmation strings derive from `ENGINE_IDS` so they stay correct as engines are added.
- [`src/components/memory/TurnTimeline.tsx`](src/components/memory/TurnTimeline.tsx) — one column per turn, four colored squares per turn (cyan added for tanmemory). Tool retains render with a ring + dot overlay; tooltip prefixes with `[tool]` or `[middleware]`.
- Scrub timeline deep links: [`/$sessionId/scrub/$turnN`](src/routes/$sessionId/scrub/$turnN.tsx). Both the `runs` route and scrub route now derive their per-engine fact maps from `ENGINE_IDS` (no more hardcoded `['hindsight','mem0','honcho']` literals).
- Reset all → `POST /api/sessions/reset`, rotate `sessionId`, reload.

### Debug surface (development only)

`GET /api/debug/last-recall` and `GET /api/debug/last-turn` return **404** when `NODE_ENV === 'production'`. In dev they still expose `globalThis.__lastRecallBySession` / `__lastTurnBySession` for the demo UI. The `__lastRecallBySession` payload now also carries `engineSystemPrompt`, `toolGuidance`, and `toolCount` so the debug strip can show what the engine contributed.

### Docker

`docker compose --profile engines up -d` brings up Hindsight (8888/9999), mem0 (8000 + pgvector), and Honcho (8001 + pgvector + redis + deriver). **TanMemory is in-process** and needs no docker — it uses the app's per-session SQLite via the `sqlite-vec` extension.

Per-engine profiles also work: `--profile hindsight`, `--profile mem0`, `--profile honcho`. See [README.md](README.md) for the full table.

## Recent changes

- **`7ca8b9a` Driver interface refactor.** `RecallResult` grew `systemPrompt`/`tools`/`toolGuidance`. `MemoryEngine` renamed to `MemoryDriver`. Each driver renders its own system-prompt block in its native shape (Hindsight uses `recallResponseToPromptString`; mem0 renders a fragments list; Honcho passes the dialectic paragraph). Hindsight gained three LLM tools (`hindsight_retain`/`_recall`/`_reflect`) with the documented guidance text. Added `source` column to `retains` and `recalls`; orchestrator now distinguishes middleware vs tool events via a session-scoped buffer.
- **`183f547` TanMemory engine.** New 4th engine built from scratch: OpenAI embeddings + Claude Haiku extraction/consolidation + sqlite-vec storage + same three-tool surface as Hindsight. Validates the hypothesis that the plumbing for an engine like this is straightforward; the harder part is consolidation prompt tuning. End-to-end smoke test in `tests/tanmemory-smoke.test.ts` runs scripted T1/T2/T3 against live OpenAI + Anthropic and verifies that the duplicate gets correctly consolidated.

## How to run

```bash
cp .env.example .env   # fill ANTHROPIC_API_KEY and OPENAI_API_KEY (both required)
docker compose --profile engines up -d
pnpm install
pnpm dev
```

Open `http://localhost:3000/`. Smoke: send `i like pancakes` → within a few seconds the **mem0** and **TanMemory** columns should show a fact without tab refresh; **Hindsight** typically lands soon after; **Honcho** may need ~10s (its deriver is async).

## Deferred

1. Hindsight user-scoped like mem0/Honcho.
2. Tools-mode for mem0 or Honcho — both have tool surfaces in their SDKs, but neither lists tools as their canonical pattern. Out of scope.
3. Cross-session memory for TanMemory (currently per-session like Hindsight; would be a SQLite-location swap).
4. Consolidation prompt tuning for TanMemory — first-draft prompt handles obvious duplicates correctly but failure modes will only surface on longer, messier conversations.
5. Token budgeting on rendered `systemPrompt` per engine — no per-engine `maxTokens` knob yet.
