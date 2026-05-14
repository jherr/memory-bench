# memory-bench

A side-by-side comparison harness for four AI memory engines on the same conversation. Every chat turn fans out to all four; one engine drives recall into the system prompt; four facts panels poll live so you can watch each engine's view of the user diverge.

The point isn't to declare a winner — it's a measurement instrument that surfaces *how* different memory approaches read the same input.

## The four engines

| Engine | What it is | Where it runs |
|---|---|---|
| **Hindsight** | Vectorize's open-source memory service. Three-tool surface (`retain`/`recall`/`reflect`) plus middleware. | Docker (port 8888) |
| **mem0** | Hosted-style memory service, messages-array intake, pgvector storage. | Docker (port 8000, plus pgvector postgres) |
| **Honcho** | Plastic Labs' dialectic-memory service. Async deriver synthesizes a per-peer "representation". | Docker (port 8001, plus pgvector postgres + redis) |
| **TanMemory** | In-process reference implementation built from scratch. SQLite + sqlite-vec for vectors, OpenAI embeddings, Claude Haiku for extraction + consolidation. Same three-tool surface as Hindsight. | In-process (no docker — lives in the app's per-session SQLite) |

Each driver implements the same `MemoryDriver` interface (`src/lib/memory/types.ts`). The chat route is engine-agnostic — `RecallResult` carries `systemPrompt`, `fragments`, `tools`, and `toolGuidance`, and the route just passes them through. No `if (engine === ...)` anywhere.

## Quick start

### 1. Prerequisites

- **Node.js 22+** (project uses Node 25 features, but 22+ should work)
- **pnpm 10+**
- **Docker** (only required to run Hindsight, mem0, and Honcho — TanMemory is in-process)
- **API keys** — both required, even if you only want to run TanMemory locally:
  - `ANTHROPIC_API_KEY` — used by the chat route, by mem0/Honcho/Hindsight extraction inside their containers, and by TanMemory's extraction + consolidation Haiku calls
  - `OPENAI_API_KEY` — used by mem0 (its internal LLM + embeddings) and by TanMemory's embeddings (`text-embedding-3-small`)

### 2. Environment

```bash
cp .env.example .env
```

Then fill in the values:

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...

# Service URLs (defaults match docker-compose.yml — change only if you run the engines elsewhere)
HINDSIGHT_URL=http://localhost:8888
MEM0_URL=http://localhost:8000
MEM0_ADMIN_API_KEY=
HONCHO_URL=http://localhost:8001
HONCHO_APP_NAME=memory-bench

# Models (defaults are fine for development)
MODEL_CHAT=claude-sonnet-4-5
MODEL_EXTRACTION=claude-haiku-4-5

# Optional: log every /api/chat hit (engine, session prefix, message count)
DEBUG_CHAT=

# Snapshot timing (ms after a turn before the post-snapshot fires)
SNAPSHOT_POST_DELAY_MS=5000
SNAPSHOT_POST_DELAY_MS_HONCHO=10000
```

`.env` is gitignored. `.env.example` ships with empty values for both API keys.

### 3. Start the engine containers

```bash
docker compose --profile engines up -d
```

This brings up six services:

| Service | Port | Notes |
|---|---|---|
| `hindsight` | 8888 (API), 9999 (UI) | Vectorize image, internal pg |
| `mem0` | 8000 | FastAPI shim built inline; mem0 lib over pgvector |
| `mem0-postgres` | (internal) | pgvector for mem0 |
| `honcho-api` | 8001 → 8000 | Plastic Labs image |
| `honcho-deriver` | (no port) | Async knowledge consolidation worker |
| `honcho-postgres` | (internal) | pgvector for Honcho |
| `honcho-redis` | (internal) | Cache + deriver queue |

You can also start engines individually with their own profiles: `--profile hindsight`, `--profile mem0`, `--profile honcho`. **TanMemory runs in-process** — there's no docker service for it.

First boot pulls a few hundred MB of images. Subsequent boots are fast.

To check status:

```bash
docker compose ps
docker compose logs -f hindsight    # or mem0, honcho-api, honcho-deriver
```

### 4. Run the app

```bash
pnpm install
pnpm dev
```

Then open **http://localhost:3000/**.

The app is single-page: chat on the left, four facts panels on the right (one per engine), a timeline strip at the top, and an engine selector to pick which engine drives **recall** for the current turn. All four always retain.

## Architecture in one paragraph

Every chat turn calls `runRecallForTurn(sessionId, activeEngineId, latestUserText)` for the active engine; that engine's driver returns a pre-rendered `systemPrompt` block, optional discrete `fragments` (for the debug strip), an array of `tools` to expose to the LLM (only Hindsight and TanMemory ship tools), and a `toolGuidance` string. The chat route concatenates `BASE_SYSTEM_PROMPT + toolGuidance + systemPrompt`, passes `tools` straight through to `@tanstack/ai-anthropic`, and streams the response. When the stream finishes, post-stream middleware calls `runTurn(...)` which fans `retainTurn({user, assistant})` out to every enabled engine in parallel and writes each retain receipt to the per-session SQLite log. If the LLM called a memory tool mid-stream (e.g. `hindsight_retain` or `tanmemory_recall`), those events are buffered and written to SQLite with `source: 'tool'` at the same time, so the timeline can show middleware vs tool retains distinctly.

## Per-engine behavior

| Engine | Retain (`retainTurn`) | Recall | Facts (`listFacts`) | Tools |
|---|---|---|---|---|
| **Hindsight** | Two `retain(bankId, …)` calls (`chat:user` / `chat:assistant`). | `client.recall(bankId, query, { budget: 'mid' })` → `recallResponseToPromptString` for systemPrompt + raw results as fragments. | `client.listMemories(bankId)`. | `hindsight_retain`, `hindsight_recall`, `hindsight_reflect`. |
| **mem0** | `POST /memories` with `[user, assistant]` + `user_id`. | `POST /search` with `rerank: true`, `threshold: 0.1`, `user_id`. Rendered as `- (id) text` list. | `GET /memories?user_id=...`. | none (middleware-only is mem0's canonical pattern) |
| **Honcho** | `session.addMessages([userPeer, assistantPeer])`; deriver async. | `userPeer.chat(query, { session })` → synthesized paragraph as `systemPrompt` (no fragments — synthesized output has no discrete items). | `userPeer.representation()` → parsed bullets. | none |
| **TanMemory** | Haiku extracts atomic facts → embed → KNN top-5 in sqlite-vec → if cosine ≥ 0.75, Haiku decides insert/merge/skip. Soft-delete via `supersededBy`. | Embed query → KNN top-8 → render as `- (tanmemory#id) text`. | All active rows from `tanmemory_memories`. | `tanmemory_retain`, `tanmemory_recall`, `tanmemory_reflect`. |

Scope keys differ deliberately:
- **Hindsight** uses bank id `userId__sessionId` (session-bucketed).
- **mem0** scopes by `user_id` only (facts survive session rotation).
- **Honcho** uses workspace + peer id (knowledge can persist across sessions).
- **TanMemory** stores in the per-session SQLite file (fully session-scoped).

See [docs/fairness.md](docs/fairness.md) for why these asymmetries are intentional.

## LLM tools

When Hindsight or TanMemory is the active engine, the model also gets three callable tools. The model decides when to use them — they're not invoked every turn. Each is wired so that a mid-turn `*_retain` writes to the per-session SQLite `retains` table with `source: 'tool'` (vs `source: 'middleware'` for the post-stream fan-out). The timeline UI renders the two source kinds with distinct visual markers.

Tool wiring lives in `src/server/memory/hindsight-tools.ts` and `src/server/memory/tanmemory-tools.ts`. Tool events route through a small session-scoped buffer (`src/server/memory/tool-event-buffer.ts`) so they get correctly tagged when the orchestrator drains them.

## Storage

Each chat session gets its own SQLite file at `data/sessions/<sessionId>.sqlite`. Tables:

- `session_meta` — mode (explorer/scientist), models, locked engine
- `turns` — every user+assistant pair plus the active engine for that turn
- `retains` — one row per retain attempt per engine (with `source: 'middleware' | 'tool' | NULL`)
- `recalls` — one row per recall attempt (with the same `source` discriminator)
- `snapshots` — pre/post engine state snapshots, fired ~5s after a turn (~10s for Honcho)
- `tanmemory_memories` + `tanmemory_vec` — TanMemory's storage. `tanmemory_vec` is a `sqlite-vec` virtual table with `FLOAT[1536]` embeddings.

The `sqlite-vec` extension is loaded on every session-DB open (`src/server/db/sessionDb.ts`). Drizzle handles the regular tables; the `vec0` virtual table is created via raw SQL as a post-step in `applyMigrations`.

Reset all (button in the UI) wipes:
- Hindsight bank for every known session
- mem0 demo-user store
- Honcho workspace
- The entire `data/sessions` directory (which inherits TanMemory's reset)

## Testing

```bash
pnpm test           # unit + integration tests, no API calls
pnpm typecheck      # tsc --noEmit
```

There's a live smoke test for TanMemory that talks to real OpenAI + Anthropic. Skipped by default:

```bash
RUN_TANMEMORY_SMOKE=1 pnpm test tests/tanmemory-smoke.test.ts
```

It runs the T1/T2/T3 scripted conversation, verifies consolidation merges the duplicate fact, and exercises the reflect synthesis path.

## Project layout

```
src/
  lib/memory/types.ts              ← MemoryDriver interface, EngineId, ENGINE_IDS
  server/
    memory/
      index.ts                     ← driver registry
      orchestrator.ts              ← runTurn / runRecallForTurn, snapshots, retain fan-out
      tool-event-buffer.ts         ← session-scoped tool-event buffer
      hindsight.ts                 ← Hindsight driver
      hindsight-tools.ts
      mem0.ts                      ← mem0 driver
      honcho.ts                    ← Honcho driver
      tanmemory.ts                 ← TanMemory driver (in-process)
      tanmemory-tools.ts
      tanmemory-embeddings.ts      ← OpenAI text-embedding-3-small wrapper
      tanmemory-consolidate.ts     ← Haiku extraction + insert/merge/skip decision
    db/
      schema.ts                    ← Drizzle schema
      sessionDb.ts                 ← per-session SQLite open, sqlite-vec load, migrations
      repo.ts                      ← insert/get helpers
      migrations/                  ← Drizzle-generated SQL
  routes/
    api.chat.ts                    ← chat SSE route, retain middleware
    api.sessions.reset.ts          ← Reset all
    api.memory.$engine.{inspect,facts}.ts
    index.tsx                      ← the bench UI (chat + 4 columns + timeline)
    $sessionId/scrub/$turnN.tsx    ← per-turn read-only scrubber
    runs.$runId.tsx                ← scripted run replay
  components/memory/               ← UI components
tests/                             ← Vitest specs
docker-compose.yml                 ← engine services
```

## Status & history

- [STATUS.md](STATUS.md) — what's currently working, recent changes, deferred items
- [docs/fairness.md](docs/fairness.md) — why the engine wrinkles are kept honest

## License

This is research / demo code for a YouTube video. No license declared. Use the engine SDKs (Hindsight, mem0, Honcho) under their own licenses.
