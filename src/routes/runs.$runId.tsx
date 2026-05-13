import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { InspectorHost } from '#/components/memory/InspectorHost'
import { ENGINE_IDS } from '#/lib/memory/types'
import type { EngineId } from '#/lib/memory/types'

type RunIndex = {
  id: string
  scriptId: string
  ts: string
  sessionIds: Array<string>
}

type SessionSnap = {
  sessionId: string
  turnCount: number
  snapshotsAtMaxTurnJson: Record<EngineId, string | null>
}

type RunLoaderData = {
  index: RunIndex
  sessions: Array<SessionSnap>
}

const fetchRunData = createServerFn({ method: 'GET' })
  .inputValidator((data: { runId: string }) => data)
  .handler(async ({ data }): Promise<RunLoaderData> => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { getSnapshotsAtTurn, getTurns } = await import('#/server/db/repo')
    const RUNS_DIR = path.resolve(process.cwd(), 'data', 'runs')
    const indexPath = path.join(RUNS_DIR, `${data.runId}.json`)
    if (!fs.existsSync(indexPath)) {
      throw new Error('run not found')
    }
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as RunIndex
    const sessions: Array<SessionSnap> = index.sessionIds.map((sid) => {
      try {
        const turns = getTurns(sid)
        const maxTurn = turns.at(-1)?.id ?? 0
        const snaps = maxTurn > 0 ? getSnapshotsAtTurn(sid, maxTurn, 'post') : []
        const byEngine: Record<EngineId, string | null> = {
          hindsight: null,
          mem0: null,
          honcho: null,
        }
        for (const s of snaps) {
          byEngine[s.engine as EngineId] = s.dataJson
        }
        return {
          sessionId: sid,
          turnCount: turns.length,
          snapshotsAtMaxTurnJson: byEngine,
        }
      } catch {
        return {
          sessionId: sid,
          turnCount: 0,
          snapshotsAtMaxTurnJson: {
            hindsight: null,
            mem0: null,
            honcho: null,
          },
        }
      }
    })
    return { index, sessions }
  })

export const Route = createFileRoute('/runs/$runId')({
  loader: async ({ params }): Promise<RunLoaderData> => {
    return await fetchRunData({ data: { runId: params.runId } })
  },
  component: RunsPage,
})

function RunsPage() {
  const { index, sessions } = Route.useLoaderData()
  const [engine, setEngine] = useState<EngineId>('hindsight')

  const parseSnap = (raw: string | null): unknown => {
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

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
                data={parseSnap(s.snapshotsAtMaxTurnJson[engine])}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
