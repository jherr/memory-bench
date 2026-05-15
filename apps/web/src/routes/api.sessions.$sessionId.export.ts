import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'

import { getSessionDb, getSessionFilePath } from '#/server/bench-db'
import { isValidSessionId } from '#/server/validation/ids'

export const Route = createFileRoute('/api/sessions/$sessionId/export')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!isValidSessionId(params.sessionId)) {
          return new Response(JSON.stringify({ error: 'invalid session id' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const filePath = getSessionFilePath(params.sessionId)
        if (!fs.existsSync(filePath)) {
          return new Response(JSON.stringify({ error: 'session not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        try {
          const db = getSessionDb(params.sessionId)
          ;(db as any).$client?.pragma?.('wal_checkpoint(FULL)')
        } catch {}
        const buf = fs.readFileSync(filePath)
        return new Response(buf, {
          headers: {
            'Content-Type': 'application/x-sqlite3',
            'Content-Disposition': `attachment; filename="${params.sessionId}.sqlite"`,
          },
        })
      },
    },
  },
})
