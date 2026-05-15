import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/debug/last-recall')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (process.env.NODE_ENV === 'production') {
          return new Response(null, { status: 404 })
        }
        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId')
        const g = globalThis as any
        if (sessionId === '__all__') {
          const sessions = Object.keys(g.__lastRecallBySession ?? {})
          const summaries = sessions.map((s) => {
            const e = g.__lastRecallBySession[s]
            return {
              sessionId: s,
              engineId: e.engineId,
              query: e.query,
              fragments: e.fragments.length,
              takenAt: e.takenAt,
            }
          })
          return new Response(JSON.stringify({ sessions: summaries }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (!sessionId) {
          return new Response(JSON.stringify({ error: 'sessionId required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const entry = g.__lastRecallBySession?.[sessionId] ?? null
        return new Response(JSON.stringify({ entry }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
