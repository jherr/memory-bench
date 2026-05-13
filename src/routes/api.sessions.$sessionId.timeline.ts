import { createFileRoute } from '@tanstack/react-router'

import { getTimelineRows } from '#/server/db/repo'

export const Route = createFileRoute('/api/sessions/$sessionId/timeline')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
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
