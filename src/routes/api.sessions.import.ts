import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'
import path from 'node:path'

const SESSIONS_DIR = path.resolve(process.cwd(), 'data', 'sessions')

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
        fs.mkdirSync(SESSIONS_DIR, { recursive: true })
        const target = path.join(SESSIONS_DIR, `${newId}.sqlite`)
        const buf = Buffer.from(await file.arrayBuffer())
        fs.writeFileSync(target, buf)
        return new Response(JSON.stringify({ sessionId: newId }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
