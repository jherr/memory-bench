import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'
import path from 'node:path'

import { isValidScriptId, isValidSessionId } from '#/server/validation/ids'

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
        if (!isValidScriptId(body.scriptId)) {
          return new Response(JSON.stringify({ error: 'invalid scriptId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (
          body.sessionIds.length === 0 ||
          body.sessionIds.some((sessionId) => !isValidSessionId(sessionId))
        ) {
          return new Response(JSON.stringify({ error: 'invalid sessionIds' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
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
