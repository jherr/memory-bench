import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { ConsolidationToggle } from '#/components/memory/ConsolidationToggle'
import { InspectorHost } from '#/components/memory/InspectorHost'
import { TurnTimeline } from '#/components/memory/TurnTimeline'
import { getSessionMeta } from '#/server/db/repo'
import { getSnapshotsAtTurn, getTurns } from '#/server/db/repo'
import { ENGINE_IDS } from '#/lib/memory/types'
import type { EngineId } from '#/lib/memory/types'

const phaseSearch = z.object({
  phase: z.enum(['pre', 'post']).default('post'),
})

type ScrubLoaderData = {
  turns: Array<{
    id: number
    ts: string
    userContent: string
    assistantContent: string
    activeEngine: EngineId
  }>
  snapshotsByEngine: Record<EngineId, unknown>
  meta: {
    modelChat: string | null
    modelExtraction: string | null
  }
}

export const Route = createFileRoute('/chat/$sessionId/scrub/$turnN')({
  validateSearch: phaseSearch,
  loaderDeps: ({ search }) => ({ phase: search.phase }),
  loader: async ({ params, deps }): Promise<ScrubLoaderData> => {
    const turnN = Number(params.turnN)
    const allTurns = getTurns(params.sessionId)
    const upTo = allTurns.filter((t) => t.id <= turnN)
    const snaps = getSnapshotsAtTurn(params.sessionId, turnN, deps.phase)
    const meta = getSessionMeta(params.sessionId)
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
      turns: upTo.map((t) => ({
        id: t.id,
        ts: t.ts,
        userContent: t.userContent,
        assistantContent: t.assistantContent,
        activeEngine: t.activeEngine as EngineId,
      })),
      snapshotsByEngine: byEngine,
      meta: {
        modelChat: meta?.modelChat ?? null,
        modelExtraction: meta?.modelExtraction ?? null,
      },
    }
  },
  component: ScrubPage,
})

function ScrubPage() {
  const { sessionId, turnN } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const data = Route.useLoaderData()
  const [showTranscript, setShowTranscript] = useState(true)
  const turnIdNum = Number(turnN)

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-gray-900 text-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-orange-500/20">
        <div className="flex items-center gap-3">
          <Link to="/chat" className="text-orange-300 hover:text-orange-200">
            ← back to live
          </Link>
          <h1 className="text-lg font-bold">
            scrub · turn {turnIdNum} ·{' '}
            <span className="text-gray-400 text-xs font-mono">
              {sessionId.slice(0, 8)}…
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <ConsolidationToggle
            phase={search.phase}
            onChange={(p) =>
              navigate({ search: () => ({ phase: p }), replace: true })
            }
          />
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="text-xs text-gray-400 hover:text-white"
          >
            {showTranscript ? 'hide transcript' : 'show transcript'}
          </button>
        </div>
      </div>
      <div className="border-b border-orange-500/10">
        <TurnTimeline
          sessionId={sessionId}
          refreshKey={0}
          highlightTurnId={turnIdNum}
        />
      </div>
      <div className="flex-1 flex min-h-0">
        {showTranscript && (
          <div className="w-[320px] border-r border-orange-500/20 overflow-auto p-3 text-xs">
            <div className="text-gray-500 mb-2">
              transcript through turn {turnIdNum}
            </div>
            {data.turns.map((t) => (
              <div key={t.id} className="mb-3">
                <div className="text-[10px] text-gray-600 mb-1">
                  turn {t.id} · {t.activeEngine}
                </div>
                <div className="text-gray-300 whitespace-pre-wrap">
                  <span className="text-gray-500">user:</span> {t.userContent}
                </div>
                <div className="text-gray-200 whitespace-pre-wrap mt-1">
                  <span className="text-gray-500">asst:</span>{' '}
                  {t.assistantContent}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex-1 grid grid-cols-3 min-h-0">
          {ENGINE_IDS.map((id) => (
            <div key={id} className="border-r border-orange-500/10 min-h-0">
              <InspectorHost
                engineId={id}
                sessionId={sessionId}
                turnId={turnIdNum}
                data={data.snapshotsByEngine[id] ?? null}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
