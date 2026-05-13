import { createFileRoute } from '@tanstack/react-router'

import { runRecallForTurn } from '#/server/memory/orchestrator'
import type { EngineId } from '#/lib/memory/types'

export const Route = createFileRoute('/api/memory/recall')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          sessionId: string
          userMsg: string
          engineId: EngineId
        }
        const result = await runRecallForTurn(
          body.sessionId,
          body.engineId,
          body.userMsg,
        )
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
