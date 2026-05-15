import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { ConsolidationToggle } from '#/components/memory/ConsolidationToggle'
import { MemoryPanel } from '#/components/memory/MemoryPanel'
import { TurnTimeline } from '#/components/memory/TurnTimeline'
import { ENGINE_IDS } from '@tanstack/ai-memory'
import type { EngineId, FactList, MemoryFact } from '@tanstack/ai-memory'

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
  factsByEngine: Record<EngineId, Array<MemoryFact>>
  meta: {
    modelChat: string | null
    modelExtraction: string | null
  }
}

const fetchScrubData = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: { sessionId: string; turnN: number; phase: 'pre' | 'post' }) => data,
  )
  .handler(async ({ data }): Promise<ScrubLoaderData> => {
    const { getSessionMeta, getTurns } = await import('#/server/bench-db')
    const { getEngine } = await import('#/server/memory/orchestrator')
    const allTurns = getTurns(data.sessionId)
    const upTo = allTurns.filter((t) => t.id <= data.turnN)
    const meta = getSessionMeta(data.sessionId)
    const engineIds = ENGINE_IDS
    const lists = await Promise.all(
      engineIds.map(async (id) => {
        try {
          return await getEngine(id).listFacts({ sessionId: data.sessionId })
        } catch {
          return {
            engine: id,
            facts: [] as Array<MemoryFact>,
            takenAt: new Date().toISOString(),
          } satisfies FactList
        }
      }),
    )
    const factsByEngine = Object.fromEntries(
      engineIds.map((id) => [id, [] as Array<MemoryFact>]),
    ) as Record<EngineId, Array<MemoryFact>>
    lists.forEach((list, i) => {
      factsByEngine[engineIds[i]] = list.facts
    })
    return {
      turns: upTo.map((t) => ({
        id: t.id,
        ts: t.ts,
        userContent: t.userContent,
        assistantContent: t.assistantContent,
        activeEngine: t.activeEngine as EngineId,
      })),
      factsByEngine,
      meta: {
        modelChat: meta?.modelChat ?? null,
        modelExtraction: meta?.modelExtraction ?? null,
      },
    }
  })

export const Route = createFileRoute('/$sessionId/scrub/$turnN')({
  validateSearch: phaseSearch,
  loaderDeps: ({ search }) => ({ phase: search.phase }),
  loader: async ({ params, deps }): Promise<ScrubLoaderData> => {
    return await fetchScrubData({
      data: {
        sessionId: params.sessionId,
        turnN: Number(params.turnN),
        phase: deps.phase,
      },
    })
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
    <div className="flex flex-col min-h-svh h-svh bg-gray-900 text-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-orange-500/20 shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-orange-300 hover:text-orange-200">
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
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="text-xs text-gray-400 hover:text-white"
          >
            {showTranscript ? 'hide transcript' : 'show transcript'}
          </button>
        </div>
      </div>
      <div className="border-b border-orange-500/10 shrink-0">
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
              <MemoryPanel
                engineId={id}
                sessionId={sessionId}
                turnId={turnIdNum}
                data={{
                  engine: id,
                  facts: data.factsByEngine[id],
                  takenAt: new Date().toISOString(),
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
