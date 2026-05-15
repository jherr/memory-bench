import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'

import { getSessionFilePath, getTimelineRows } from '#/server/bench-db'
import { isValidSessionId } from '#/server/validation/ids'

export const Route = createFileRoute('/api/sessions/$sessionId/timeline')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          if (!isValidSessionId(params.sessionId)) {
            return new Response(JSON.stringify({ error: 'invalid session id' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          if (!fs.existsSync(getSessionFilePath(params.sessionId))) {
            return new Response(JSON.stringify({ error: 'session not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          const rows = getTimelineRows(params.sessionId)
          return new Response(JSON.stringify({ rows }), {
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (err: any) {
          return new Response(
            JSON.stringify({ error: err?.message ?? String(err) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
