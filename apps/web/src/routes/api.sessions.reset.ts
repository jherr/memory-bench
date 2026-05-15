import { createFileRoute } from '@tanstack/react-router'

type ResetResult = 'ok' | { error: string }
const RESET_TOKEN = process.env.SESSIONS_RESET_TOKEN

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
    const { closeAllLocalSessions, getLocalSessionsDir } = await import(
      '#/memory/drivers/local'
    )
    closeAllSessions()
    closeAllLocalSessions()
    const dirs = [
      getSessionsDir(),
      getLocalSessionsDir(),
      path.resolve(process.cwd(), 'data', 'runs'),
    ]
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
      POST: async ({ request }) => {
        if (process.env.NODE_ENV === 'production' && !RESET_TOKEN) {
          return new Response(
            JSON.stringify({ error: 'sessions reset disabled in production' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (RESET_TOKEN) {
          const token = request.headers.get('x-reset-token')
          if (token !== RESET_TOKEN) {
            return new Response(JSON.stringify({ error: 'unauthorized' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            })
          }
        }
        const sessionIds = await listKnownSessionIds()
        const [hindsight, mem0, honcho, local] = await Promise.all([
          resetHindsight(sessionIds),
          resetMem0(),
          resetHoncho(),
          resetLocal(),
        ])
        return new Response(
          JSON.stringify({
            ok: true,
            results: { hindsight, mem0, honcho, local },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      },
    },
  },
})
