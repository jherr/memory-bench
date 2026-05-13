import { useEffect, useState } from 'react'

import { RawJson } from './RawJson'
import type { MemorySnapshot } from '#/lib/memory/types'

type Tab = 'observations' | 'facts' | 'raw'

type HindsightMemory = {
  id?: string
  type?: string
  text?: string
  content?: string
  context?: string
  observation_state?: string
  evidence_count?: number
  trend?: string
  created_at?: string
  updated_at?: string
}

function isObservation(m: HindsightMemory): boolean {
  const t = (m.type ?? '').toLowerCase()
  return t.includes('observation')
}

function isFact(m: HindsightMemory): boolean {
  const t = (m.type ?? '').toLowerCase()
  return t.includes('fact') || t === 'world' || t === 'experience'
}

export function HindsightPanel({
  sessionId,
  turnId,
  data: dataProp,
}: {
  sessionId: string
  turnId: number
  data?: MemorySnapshot['data']
}) {
  const [tab, setTab] = useState<Tab>('observations')
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isScrubMode = dataProp !== undefined
  const data = isScrubMode ? dataProp : snapshot?.data

  useEffect(() => {
    if (isScrubMode) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    fetch(
      `/api/memory/hindsight/inspect?sessionId=${encodeURIComponent(sessionId)}`,
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json: MemorySnapshot) => {
        if (!cancelled) setSnapshot(json)
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, turnId, isScrubMode])

  const memories: Array<HindsightMemory> =
    (data as any)?.memories?.items ?? (data as any)?.memories?.memories ?? []
  const profile = (data as any)?.profile

  const observations = memories.filter(isObservation)
  const facts = memories.filter(isFact)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-orange-500/20">
        <div className="text-sm font-semibold text-orange-300">Hindsight</div>
        <div className="text-xs text-gray-400">
          {loading ? 'refreshing…' : err ? `err: ${err}` : `${memories.length} memories`}
        </div>
      </div>
      <div className="flex gap-1 px-3 pt-2">
        {(['observations', 'facts', 'raw'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-2 py-1 text-xs rounded ${
              tab === t
                ? 'bg-orange-500/30 text-orange-200'
                : 'text-gray-400 hover:text-orange-300'
            }`}
          >
            {t}
            {t === 'observations' && ` (${observations.length})`}
            {t === 'facts' && ` (${facts.length})`}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto px-3 py-2 text-xs">
        {tab === 'observations' && (
          <ul className="space-y-2">
            {observations.map((o, i) => (
              <li
                key={o.id ?? i}
                className="border border-orange-500/10 rounded p-2 bg-gray-900/40"
              >
                <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                  <span>{o.observation_state ?? o.trend ?? '—'}</span>
                  <span>{o.evidence_count != null ? `${o.evidence_count} evidence` : ''}</span>
                </div>
                <div className="text-gray-200 whitespace-pre-wrap">
                  {o.text ?? o.content ?? '(empty)'}
                </div>
              </li>
            ))}
            {observations.length === 0 && (
              <li className="text-gray-500 italic">No observations yet.</li>
            )}
          </ul>
        )}
        {tab === 'facts' && (
          <ul className="space-y-2">
            {facts.map((f, i) => (
              <li
                key={f.id ?? i}
                className="border border-orange-500/10 rounded p-2 bg-gray-900/40"
              >
                <div className="text-[10px] text-gray-500 mb-1">
                  {f.type} · {f.created_at ?? ''}
                </div>
                <div className="text-gray-200 whitespace-pre-wrap">
                  {f.text ?? f.content ?? '(empty)'}
                </div>
              </li>
            ))}
            {facts.length === 0 && (
              <li className="text-gray-500 italic">No facts yet.</li>
            )}
          </ul>
        )}
        {tab === 'raw' && (
          <div className="space-y-2">
            {profile && (
              <div>
                <div className="text-gray-400 mb-1">profile</div>
                <RawJson data={profile} />
              </div>
            )}
            <div>
              <div className="text-gray-400 mb-1">memories</div>
              <RawJson data={(data as any)?.memories ?? null} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
