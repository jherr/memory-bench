# memory-bench — status

Snapshot of where the implementation stands. Plan lives at `~/.claude/plans/silly-crunching-sparkle.md`. Spec at `~/Downloads/memory-bench.md`.

## Done

### Foundation
- Drizzle + better-sqlite3 + drizzle-kit installed; `better-sqlite3` added to pnpm's `onlyBuiltDependencies`.
- `drizzle.config.ts` + `src/server/db/schema.ts` (`turns`, `retains`, `recalls`, `snapshots` with `kind: pre|post`, `session_meta`).
- `src/server/db/sessionDb.ts` — per-session SQLite at `./data/sessions/{sessionId}.sqlite`, LRU-cached, WAL, migrations bundled via `import.meta.glob` and applied on first open (tracked in `__migrations` table).
- `src/server/db/repo.ts` — typed inserts/queries.
- `src/lib/memory/types.ts` — `MemoryEngine` interface (with `retainTurn(scope, {user, assistant})`).
- `src/lib/memory/useSessionId.ts` — localStorage-backed sessionId hook.
- `.env.example`, `.gitignore` updates, `data/sessions/.gitkeep`, `data/runs/.gitkeep`.

### M1 — Hindsight skeleton
- `src/server/memory/hindsight.ts` — adapter via official `@vectorize-io/hindsight-client` (`retain`, `recall`, `listMemories`, `getBankProfile`).
- `src/server/memory/orchestrator.ts` — `runTurn` fan-out + pre-snapshot fire-and-forget + post-snapshot via per-session `setTimeout` (default 5s, Honcho 10s).
- `src/server/memory/index.ts` — engine registry.
- Routes: `src/routes/api.chat.ts` (server-side recall + Sonnet 4.5 streaming), `api.memory.recall.ts`, `api.memory.turn.ts`, `api.memory.$engine.inspect.ts`.
- UI: `src/routes/chat/index.tsx`, `components/memory/ChatPanel.tsx` (uses `useChat.onFinish` for the post-stream turn POST), `InspectorHost.tsx`, `HindsightPanel.tsx`, `RawJson.tsx`, `EngineSelector.tsx`.
- `tests/adapters/hindsight.test.ts` — contract test, auto-skips if `HINDSIGHT_URL` unreachable.
- Hindsight service in `docker-compose.yml`.

### M2 — mem0 + Honcho
- `src/server/memory/mem0.ts` — raw HTTP against self-hosted mem0 (`POST /memories`, `POST /search`, `GET /memories`).
- `src/server/memory/honcho.ts` — uses `@honcho-ai/sdk`. `retainTurn` adds both messages to one session; `recall` uses `peer.chat`; `inspect` pulls messages + queueStatus + summaries.
- Both registered; `runTurn` fans out to all three.
- `components/memory/Mem0Panel.tsx`, `HonchoPanel.tsx`.
- `docs/fairness.md` documenting the orchestrator-passes-pair / adapter-shapes-natively decision.
- `tests/adapters/mem0.test.ts`, `tests/adapters/honcho.test.ts` — both auto-skip.

### M3 — timeline + scrub
- `components/memory/TurnTimeline.tsx` — per-turn 3-engine chips, links to scrub.
- `src/routes/api.sessions.$sessionId.timeline.ts` — timeline rows.
- `src/routes/chat/$sessionId/scrub/$turnN.tsx` — loader reads turns + snapshots at turn N for both kinds; renders 3 panels side-by-side; transcript pane.
- `ConsolidationToggle.tsx` (pre/post), `ModeToggle.tsx` (explorer/scientist; mode change mid-session → confirm-and-reset).
- Panels accept `data` prop and skip live polling in scrub mode.

### M4 — scripts + export + runs
- `src/lib/scripts/{types,loader}.ts` — Zod-validated, `import.meta.glob` of `scripts/conversations/*.json`.
- Seeded scripts: `trip-planning-v1.json`, `preference-contradictions-v1.json`.
- `components/memory/ScriptRunner.tsx` — dropdown + Run + Run × 3.
- `ChatPanel` now accepts `autoplay = { messages, interTurnDelayMs, onDone }`; Run x 3 cycles three sessionIds in the same tab (re-keyed) and navigates to `/runs/{runId}` when done.
- `src/routes/api.runs.start.ts` / `api.runs.$runId.ts` — write/read run index files under `data/runs/`.
- `src/routes/api.sessions.$sessionId.export.ts` — streams the sqlite file (runs `wal_checkpoint(FULL)` first).
- `src/routes/api.sessions.import.ts` — multipart upload → new sessionId.
- `src/routes/runs.$runId.tsx` — three-column variance view at each run's max turn.

## Docker

`docker-compose.yml` uses **published images** (no source clones):
- `ghcr.io/vectorize-io/hindsight:latest` (ports 8888, 9999)
- `mem0/mem0-api-server:latest` + `ankane/pgvector:v0.5.1` (port 8000; command overrides to run `alembic upgrade head` before uvicorn)
- `ghcr.io/plastic-labs/honcho:latest` for both api and deriver, + `pgvector/pgvector:pg15` + `redis:8.2` (api on 8001, deriver depends on api healthcheck)
- All three engines gated under `--profile engines`. Per-engine profiles also exist (`hindsight`, `mem0`, `honcho`).
- Honcho healthcheck is a TCP-level probe (Honcho 404s on `/` so an HTTP-200 probe is the wrong shape).

## Verification status

- `pnpm typecheck` — clean across all memory-bench files. Two errors remain in pre-existing demo scaffold (`demo-store-devtools.tsx`, unrelated).
- `pnpm test` — 3 passed, 9 skipped (contract tests auto-skip when engine URLs aren't reachable; that's the intended behavior).
- `pnpm dev` boots; `/chat`, `/chat/.../scrub/N`, `/api/sessions/.../timeline`, `/api/sessions/.../export`, `/api/runs/start`, `/api/runs/{runId}`, `/runs/{runId}` all return their expected shapes against an empty in-memory state.
- **Not yet verified live**: end-to-end turn cycle with all three engines actually running. Needs `.env` populated and `docker compose --profile engines up -d` succeeding. Hindsight + mem0 + Honcho-api + Honcho-deriver containers all start; one open issue documented below.

## Open items

- **Security**: real `ANTHROPIC_API_KEY` was placed in `.env.example` (a tracked template file). Should be moved to `.env` (gitignored) and the key rotated if it has been pushed anywhere. `.env.example` should hold the empty placeholder.
- **Hindsight bank cleanup**: clearing localStorage starts a fresh bank but the old one lingers on the Hindsight server. No UI button to delete; manual via Hindsight API.
- **mem0 graph mode**: requires Neo4j; not enabled. Entities tab is therefore off. Add as opt-in later.
- **Honcho deriver readiness**: image bundles both api and deriver paths; deriver is wired as a separate service depending on api's healthcheck so migrations run first.
- **Snapshot durability**: `setTimeout`-backed post-snapshots are in-process. If the dev server restarts mid-debounce, the post snapshot for that turn is lost. Acceptable for local dev; would need a `pending_snapshots` table for fidelity.
- **Anthropic rate limits during Run × 3**: sequential runs + 800 ms inter-turn delay should stay under default tier; adapter LLM calls have no backoff yet.

## How to run end-to-end

```bash
cp .env.example .env       # move ANTHROPIC_API_KEY here, leave .env.example empty
docker compose --profile engines up -d
pnpm dev
```

Open `http://localhost:3000/chat`. Pick an engine, chat a few turns, watch the panel update. Click any chip in the timeline to jump to the scrub view. Pick a script and hit Run or Run × 3.
