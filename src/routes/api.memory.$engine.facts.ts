import { createFileRoute } from '@tanstack/react-router'

import { getEngine } from '#/server/memory'
import type { EngineId } from '#/lib/memory/types'

export const Route = createFileRoute('/api/memory/$engine/facts')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId')
        if (!sessionId) {
          return new Response(JSON.stringify({ error: 'sessionId required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        try {
          const engine = getEngine(params.engine as EngineId)
          const list = await engine.listFacts({ sessionId })
          return new Response(JSON.stringify(list), {
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (err: any) {
          return new Response(
            JSON.stringify({ error: err?.message ?? String(err) }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
      },
    },
  },
})
