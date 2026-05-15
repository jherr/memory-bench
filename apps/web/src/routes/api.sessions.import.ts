import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'
import path from 'node:path'

import { getSessionsDir } from '#/server/bench-db'

const MAX_IMPORT_BYTES = Number(process.env.MAX_SESSION_IMPORT_BYTES ?? 10 * 1024 * 1024)
const SQLITE_HEADER = Buffer.from('SQLite format 3\u0000', 'utf8')

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
        if (file.size <= 0 || file.size > MAX_IMPORT_BYTES) {
          return new Response(
            JSON.stringify({
              error: `file size must be between 1 and ${MAX_IMPORT_BYTES} bytes`,
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }
        const newId = crypto.randomUUID()
        const sessionsDir = getSessionsDir()
        fs.mkdirSync(sessionsDir, { recursive: true })
        const target = path.join(sessionsDir, `${newId}.sqlite`)
        const buf = Buffer.from(await file.arrayBuffer())
        if (buf.length < SQLITE_HEADER.length || !buf.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
          return new Response(JSON.stringify({ error: 'invalid sqlite file' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        fs.writeFileSync(target, buf)
        return new Response(JSON.stringify({ sessionId: newId }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
