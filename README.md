# memory-bench

NX/pnpm monorepo for the AI memory comparison bench.

- `apps/web` contains the TanStack Start bench UI and API routes.
- `packages/ai-memory` contains the shared `@tanstack/ai-memory` package: memory driver types,  and the Hindsight, mem0, Honcho, and TanMemory drivers.

Common commands:

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

See `apps/web/README.md` for app setup, Docker engine services, and memory-engine behavior.
