import { createFileRoute } from '@tanstack/react-router'

type ResetResult = 'ok' | { error: string }

async function resetHindsight(sessionIds: Array<string>): Promise<ResetResult> {
  try {
    const { resetHindsightBank } = await import('@tanstack/ai-memory/hindsight')
    await Promise.allSettled(
      sessionIds.map((sid) => resetHindsightBank('demo-user', sid)),
    )
    return 'ok'
  } catch (err: any) {
    return { error: err?.message ?? String(err) }
  }
}

async function resetMem0(): Promise<ResetResult> {
  try {
    const { resetMem0User } = await import('@tanstack/ai-memory/mem0')
    await resetMem0User('demo-user')
    return 'ok'
  } catch (err: any) {
    return { error: err?.message ?? String(err) }
  }
}

async function resetHoncho(): Promise<ResetResult> {
  try {
    const { resetHonchoWorkspace } = await import('@tanstack/ai-memory/honcho')
    await resetHonchoWorkspace()
    return 'ok'
  } catch (err: any) {
    return { error: err?.message ?? String(err) }
  }
}

async function resetLocal(): Promise<ResetResult> {
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { closeAllSessions, getSessionsDir } = await import(
      '#/server/bench-db'
    )
    closeAllSessions()
    const dirs = [getSessionsDir(), path.resolve(process.cwd(), 'data', 'runs')]
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      for (const name of fs.readdirSync(dir)) {
        if (name === '.gitkeep') continue
        const full = path.join(dir, name)
        try {
          fs.rmSync(full, { recursive: true, force: true })
        } catch {
          // ignore — best effort
        }
      }
    }
    return 'ok'
  } catch (err: any) {
    return { error: err?.message ?? String(err) }
  }
}

async function listKnownSessionIds(): Promise<Array<string>> {
  try {
    const fs = await import('node:fs')
    const { getSessionsDir } = await import('#/server/bench-db')
    const dir = getSessionsDir()
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sqlite'))
      .map((f) => f.replace(/\.sqlite$/, ''))
  } catch {
    return []
  }
}

export const Route = createFileRoute('/api/sessions/reset')({
  server: {
    handlers: {
      POST: async () => {
        const sessionIds = await listKnownSessionIds()
        const [hindsight, mem0, honcho, local] = await Promise.all([
          resetHindsight(sessionIds),
          resetMem0(),
          resetHoncho(),
          resetLocal(),
        ])
        // TanMemory's storage is the per-session SQLite file itself, which
        // resetLocal() wipes. Surface it as a distinct result so the UI / logs
        // reflect the 4th engine, but it inherits resetLocal's status.
        const tanmemory: ResetResult = local
        return new Response(
          JSON.stringify({
            ok: true,
            results: { hindsight, mem0, honcho, tanmemory, local },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      },
    },
  },
})
