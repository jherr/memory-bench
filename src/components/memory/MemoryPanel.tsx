import { useEffect, useState } from 'react'

import type { EngineId, FactList } from '#/lib/memory/types'

const ENGINE_THEME: Record<
  EngineId,
  {
    label: string
    headerText: string
    headerBorder: string
    itemBorder: string
    bullet: string
  }
> = {
  hindsight: {
    label: 'Hindsight',
    headerText: 'text-orange-300',
    headerBorder: 'border-orange-500/20',
    itemBorder: 'border-orange-500/10',
    bullet: 'bg-orange-500',
  },
  mem0: {
    label: 'mem0',
    headerText: 'text-violet-300',
    headerBorder: 'border-violet-500/30',
    itemBorder: 'border-violet-500/20',
    bullet: 'bg-violet-500',
  },
  honcho: {
    label: 'honcho',
    headerText: 'text-emerald-300',
    headerBorder: 'border-emerald-500/30',
    itemBorder: 'border-emerald-500/20',
    bullet: 'bg-emerald-500',
  },
}

const EMPTY_HINT: Record<EngineId, string> = {
  hindsight: 'No facts yet. State a durable preference or constraint to seed it.',
  mem0: 'No facts yet. mem0 distills facts from user/assistant pairs.',
  honcho: 'No facts yet. Honcho derives async — give it ~10s after a turn.',
}

export function MemoryPanel({
  engineId,
  sessionId,
  turnId,
  data,
}: {
  engineId: EngineId
  sessionId: string
  turnId: number
  data?: FactList | null
}) {
  const theme = ENGINE_THEME[engineId]
  const isScrubMode = data !== undefined
  const [facts, setFacts] = useState<FactList | null>(
    isScrubMode ? (data ?? null) : null,
  )
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (isScrubMode) {
      setFacts(data ?? null)
      return
    }
    let cancelled = false
    const load = async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true)
      try {
        const res = await fetch(
          `/api/memory/${engineId}/facts?sessionId=${encodeURIComponent(sessionId)}`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as FactList
        if (!cancelled) {
          setFacts(json)
          setErr(null)
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message)
      } finally {
        if (!cancelled && showSpinner) setLoading(false)
      }
    }
    void load(true)
    const handle = setInterval(() => void load(false), 2000)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [engineId, sessionId, turnId, isScrubMode, data])

  const items = facts?.facts ?? []

  return (
    <div className="flex flex-col h-full min-w-0">
      <div
        className={`flex items-center justify-between px-3 py-2 border-b ${theme.headerBorder}`}
      >
        <div className={`text-sm font-semibold ${theme.headerText}`}>
          {theme.label}
        </div>
        <div className="text-xs text-gray-400">
          {loading
            ? 'refreshing…'
            : err
              ? `err: ${err}`
              : `${items.length} fact${items.length === 1 ? '' : 's'}`}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-3 py-2 text-xs">
        {items.length === 0 ? (
          <div className="text-gray-500 italic">{EMPTY_HINT[engineId]}</div>
        ) : (
          <ul className="space-y-2">
            {items.map((f) => (
              <li
                key={f.id}
                className={`flex gap-2 border ${theme.itemBorder} rounded p-2 bg-gray-900/40`}
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${theme.bullet}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="text-gray-200 whitespace-pre-wrap break-words">
                    {f.text}
                  </div>
                  {(f.source || f.createdAt) && (
                    <div className="text-[10px] text-gray-500 mt-1">
                      {[f.source, f.createdAt].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
