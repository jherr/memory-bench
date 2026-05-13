import { createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'
import path from 'node:path'

const RUNS_DIR = path.resolve(process.cwd(), 'data', 'runs')

export const Route = createFileRoute('/api/runs/$runId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const filePath = path.join(RUNS_DIR, `${params.runId}.json`)
        if (!fs.existsSync(filePath)) {
          return new Response(JSON.stringify({ error: 'run not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const data = fs.readFileSync(filePath, 'utf8')
        return new Response(data, {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
