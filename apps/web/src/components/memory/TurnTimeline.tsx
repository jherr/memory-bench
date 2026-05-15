import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'

import type { EngineId } from '@tanstack/ai-memory'

type RetainSource = 'middleware' | 'tool' | null

type TimelineRow = {
  turnId: number
  ts: string
  activeEngine: EngineId
  perEngine: Array<{
    engine: EngineId
    ok: boolean
    latencyMs: number
    error: string | null
    source: RetainSource
  }>
}

const COLORS: Record<EngineId, { ok: string; err: string; pending: string }> = {
  hindsight: {
    ok: 'bg-orange-500/70',
    err: 'bg-red-500',
    pending: 'bg-orange-500/20',
  },
  mem0: {
    ok: 'bg-violet-500/70',
    err: 'bg-red-500',
    pending: 'bg-violet-500/20',
  },
  honcho: {
    ok: 'bg-emerald-500/70',
    err: 'bg-red-500',
    pending: 'bg-emerald-500/20',
  },
  local: {
    ok: 'bg-cyan-500/70',
    err: 'bg-red-500',
    pending: 'bg-cyan-500/20',
  },
}

const ENGINES: Array<EngineId> = ['hindsight', 'mem0', 'honcho', 'local']

export function TurnTimeline({
  sessionId,
  refreshKey,
  highlightTurnId,
}: {
  sessionId: string
  refreshKey: number
  highlightTurnId?: number
}) {
  const [rows, setRows] = useState<Array<TimelineRow>>([])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/timeline`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setRows(data.rows ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionId, refreshKey])

  if (rows.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic px-3 py-1">
        no turns yet
      </div>
    )
  }

  return (
    <div className="flex gap-1 px-3 py-1 overflow-x-auto">
      {rows.map((row) => {
        const byEngine = new Map<EngineId, Array<TimelineRow['perEngine'][number]>>()
        for (const p of row.perEngine) {
          const list = byEngine.get(p.engine) ?? []
          list.push(p)
          byEngine.set(p.engine, list)
        }
        const isHighlighted = highlightTurnId === row.turnId
        return (
          <Link
            key={row.turnId}
            to="/$sessionId/scrub/$turnN"
            params={{ sessionId, turnN: String(row.turnId) }}
            className={`group flex flex-col items-center min-w-[28px] px-1 py-0.5 rounded text-[10px] hover:bg-gray-800 ${
              isHighlighted ? 'bg-gray-800 ring-1 ring-orange-400/50' : ''
            }`}
            title={`Turn ${row.turnId} · active: ${row.activeEngine} · ${row.ts}`}
          >
            <span className="text-gray-500 group-hover:text-gray-300">
              {row.turnId}
            </span>
            <div className="flex gap-0.5 mt-0.5">
              {ENGINES.map((id) => {
                const entries = byEngine.get(id) ?? []
                const color = COLORS[id]
                if (entries.length === 0) {
                  return (
                    <span
                      key={id}
                      className={`w-2 h-2 rounded-sm ${color.pending}`}
                      title={`${id}: no retain`}
                    />
                  )
                }
                return (
                  <span key={id} className="flex gap-px">
                    {entries.map((status, i) => {
                      const cls = status.ok ? color.ok : color.err
                      const src = status.source ?? 'middleware'
                      const isTool = src === 'tool'
                      return (
                        <span
                          key={i}
                          className={`relative w-2 h-2 rounded-sm ${cls} ${
                            isTool ? 'ring-1 ring-white/60' : ''
                          }`}
                          title={`[${src}] ${id}: ${
                            status.ok ? 'ok' : `err — ${status.error}`
                          } (${status.latencyMs}ms)`}
                        >
                          {isTool ? (
                            <span className="absolute inset-0 m-auto w-[3px] h-[3px] rounded-full bg-white/90" />
                          ) : null}
                        </span>
                      )
                    })}
                  </span>
                )
              })}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
