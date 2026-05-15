import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'
import path from 'node:path'

import { getSessionsDir } from '#/server/bench-db'

export const Route = createFileRoute('/api/sessions/import')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData()
        const file = form.get('file')
        if (!(file instanceof File)) {
          return new Response(
            JSON.stringify({ error: 'file field is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }
        const newId = crypto.randomUUID()
        const sessionsDir = getSessionsDir()
        fs.mkdirSync(sessionsDir, { recursive: true })
        const target = path.join(sessionsDir, `${newId}.sqlite`)
        const buf = Buffer.from(await file.arrayBuffer())
        fs.writeFileSync(target, buf)
        return new Response(JSON.stringify({ sessionId: newId }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
