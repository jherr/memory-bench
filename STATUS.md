# memory-bench — status

Companion plan: [PLAN.md](PLAN.md).

## What “working” means (2026-05-14)

All three engines (**Hindsight**, **mem0**, **Honcho**) are wired for the same canonical pattern on **`/`** (the only primary UI route):

1. **Recall** — Before the model streams, the server runs `runRecallForTurn(sessionId, activeEngineId, latestUserText)` and injects ranked fragments into the system prompt.
2. **Retain** — After the assistant finishes, `memory-retain` middleware `ctx.defer`s `runTurn(...)` so user + assistant text is written to SQLite and fanned out to every enabled engine without blocking SSE start.
3. **Facts panel** — Each column calls `GET /api/memory/{engine}/facts?sessionId=...`. In **live** mode the UI polls every **2s** via `useIntervalPolling` (stable deps: `engineId` + `sessionId` only — not `turnId`, so completing a turn no longer tears down the timer). **Scrub** mode passes server-loaded `data` and does not poll.

### Engine-specific behavior

| Engine | Save (`retainTurn`) | Recall | Facts (`listFacts`) | Scope |
|--------|---------------------|--------|----------------------|--------|
| **Hindsight** | Two `retain(bankId, …)` calls (`chat:user` / `chat:assistant`). | `recall(bankId, query, { budget: 'mid' })` → fragments. | `listMemories(bankId)`. | Bank id `userId__sessionId` (session-bucketed). |
| **mem0** | `POST /memories` with `[user, assistant]` + `user_id`. | `POST /search` with `rerank: true`, `threshold: 0.1`, `user_id`. | `GET /memories?user_id=...`. | `user_id` only — survives session rotation. |
| **Honcho** | `session.addMessages([userPeer, assistantPeer])`; deriver async. | `userPeer.chat(query, { session })` → paragraph. | `userPeer.representation()` → parsed bullets (not `conclusions.list()` — too noisy). | Workspace + peer; knowledge persists across sessions. |

### Chat route

- [src/routes/api.chat.ts](src/routes/api.chat.ts) — Reads `body.data.{sessionId, engineId}` (TanStack AI nesting). Optional request logging: set **`DEBUG_CHAT=1`** in `.env`.
- [src/server/memory/orchestrator.ts](src/server/memory/orchestrator.ts) — `runTurn` / `runRecallForTurn`, SQLite ledger, snapshots.

### UI

- [src/routes/index.tsx](src/routes/index.tsx) — **`/`** full-viewport memory bench (chat + three [MemoryPanel](src/components/memory/MemoryPanel.tsx) columns). No app chrome (no header / theme toggle).
- Scrub timeline deep links: [`/$sessionId/scrub/$turnN`](src/routes/$sessionId/scrub/$turnN.tsx) (same bench data, read-only panels + phase toggle).
- Reset all → `POST /api/sessions/reset`, rotate `sessionId`, reload.
- Seed chips, last-recall strip (polls debug endpoints while loading).

### Debug surface (development only)

`GET /api/debug/last-recall` and `GET /api/debug/last-turn` return **404** when `NODE_ENV === 'production'`. In dev they still expose `globalThis.__lastRecallBySession` / `__lastTurnBySession` for the demo UI.

### Docker

`docker compose --profile engines up -d` — images and ports are unchanged from the prior snapshot (Hindsight 8888/9999, mem0 8000, Honcho 8001 + Postgres + Redis). See [README.md](README.md).

## Recent maintenance (PLAN.md)

- Stable memory panel polling: [usePolling.ts](src/components/memory/usePolling.ts) + [MemoryPanel.tsx](src/components/memory/MemoryPanel.tsx).
- Removed legacy `POST /api/memory/turn` route (retain is middleware-only). Standalone `/api/memory/recall` was already absent from the tree.
- Production gates on debug routes; chat hit log behind `DEBUG_CHAT=1`.
- Honcho: `parseHonchoRepresentationToFacts` + tests; Hindsight: `bankIdFor` docstring.

## How to run

```bash
cp .env.example .env   # fill ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
docker compose --profile engines up -d
pnpm dev
```

Open `http://localhost:3000/`. Smoke: send `i like pancakes` → within a few seconds the **mem0** column should show a fact **without** tab refresh; Honcho may need ~10s.

## Deferred (see [PLAN.md](PLAN.md))

1. Hindsight user-scoped like mem0/Honcho.
2. Remove scrub / runs / scientist / SQLite if out of scope for the video.
