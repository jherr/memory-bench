import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'
import path from 'node:path'

const RUNS_DIR = path.resolve(process.cwd(), 'data', 'runs')

export const Route = createFileRoute('/api/runs/start')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          scriptId: string
          sessionIds: Array<string>
        }
        if (!body.scriptId || !Array.isArray(body.sessionIds)) {
          return new Response(
            JSON.stringify({ error: 'scriptId and sessionIds required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }
        fs.mkdirSync(RUNS_DIR, { recursive: true })
        const runId = `${body.scriptId}-${Date.now()}`
        const indexPath = path.join(RUNS_DIR, `${runId}.json`)
        fs.writeFileSync(
          indexPath,
          JSON.stringify(
            {
              id: runId,
              scriptId: body.scriptId,
              ts: new Date().toISOString(),
              sessionIds: body.sessionIds,
            },
            null,
            2,
          ),
        )
        return new Response(JSON.stringify({ runId }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
