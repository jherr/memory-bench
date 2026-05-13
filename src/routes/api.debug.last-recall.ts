import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/debug/last-recall')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId')
        if (!sessionId) {
          return new Response(JSON.stringify({ error: 'sessionId required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const g = globalThis as any
        const entry = g.__lastRecallBySession?.[sessionId] ?? null
        return new Response(JSON.stringify({ entry }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
