import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import fs from 'node:fs'
import path from 'node:path'

import { InspectorHost } from '#/components/memory/InspectorHost'
import { getSnapshotsAtTurn, getTurns } from '#/server/db/repo'
import { ENGINE_IDS } from '#/lib/memory/types'
import type { EngineId } from '#/lib/memory/types'

const RUNS_DIR = path.resolve(process.cwd(), 'data', 'runs')

type RunIndex = {
  id: string
  scriptId: string
  ts: string
  sessionIds: Array<string>
}

type SessionSnap = {
  sessionId: string
  turnCount: number
  snapshotsAtMaxTurn: Record<EngineId, unknown>
}

export const Route = createFileRoute('/runs/$runId')({
  loader: async ({ params }) => {
    const indexPath = path.join(RUNS_DIR, `${params.runId}.json`)
    if (!fs.existsSync(indexPath)) {
      throw new Error('run not found')
    }
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as RunIndex
    const sessions: Array<SessionSnap> = index.sessionIds.map((sid) => {
      try {
        const turns = getTurns(sid)
        const maxTurn = turns.at(-1)?.id ?? 0
        const snaps = maxTurn > 0 ? getSnapshotsAtTurn(sid, maxTurn, 'post') : []
        const byEngine: Record<EngineId, unknown> = {
          hindsight: null,
          mem0: null,
          honcho: null,
        }
        for (const s of snaps) {
          try {
            byEngine[s.engine as EngineId] = JSON.parse(s.dataJson)
          } catch {
            byEngine[s.engine as EngineId] = null
          }
        }
        return {
          sessionId: sid,
          turnCount: turns.length,
          snapshotsAtMaxTurn: byEngine,
        }
      } catch {
        return {
          sessionId: sid,
          turnCount: 0,
          snapshotsAtMaxTurn: {
            hindsight: null,
            mem0: null,
            honcho: null,
          },
        }
      }
    })
    return { index, sessions }
  },
  component: RunsPage,
})

function RunsPage() {
  const { index, sessions } = Route.useLoaderData()
  const [engine, setEngine] = useState<EngineId>('hindsight')

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-gray-900 text-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-orange-500/20">
        <div className="flex items-center gap-3">
          <Link to="/chat" className="text-orange-300 hover:text-orange-200">
            ← back to live
          </Link>
          <h1 className="text-lg font-bold">
            variance · {index.scriptId} ·{' '}
            <span className="text-xs text-gray-400 font-mono">{index.id}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {ENGINE_IDS.map((id) => (
            <button
              key={id}
              onClick={() => setEngine(id)}
              className={`px-2 py-1 rounded ${
                engine === id
                  ? 'bg-orange-500/30 text-orange-200'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 grid grid-cols-3 min-h-0">
        {sessions.map((s, i) => (
          <div
            key={s.sessionId}
            className="border-r border-orange-500/10 min-h-0 flex flex-col"
          >
            <div className="px-3 py-1 text-[10px] text-gray-500 border-b border-orange-500/10 font-mono">
              run {i + 1} · {s.sessionId.slice(0, 8)}… · {s.turnCount} turns
            </div>
            <div className="flex-1 min-h-0">
              <InspectorHost
                engineId={engine}
                sessionId={s.sessionId}
                turnId={s.turnCount}
                data={s.snapshotsAtMaxTurn[engine] ?? null}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
