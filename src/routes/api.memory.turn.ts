import { createFileRoute } from '@tanstack/react-router'

import { runTurn } from '#/server/memory/orchestrator'
import type { EngineId, RecallResult } from '#/lib/memory/types'

export const Route = createFileRoute('/api/memory/turn')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          sessionId: string
          userMsg: string
          assistantReply: string
          activeEngineId: EngineId
          recall?: { engineId: EngineId; query: string; result: RecallResult }
        }
        const result = await runTurn(body)
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
