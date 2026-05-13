import { useEffect, useState } from 'react'

import { RawJson } from './RawJson'
import type { MemorySnapshot } from '#/lib/memory/types'

type Tab = 'memories' | 'raw'

type Mem0Memory = {
  id?: string
  memory?: string
  user_id?: string
  run_id?: string
  hash?: string
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export function Mem0Panel({
  sessionId,
  turnId,
  data: dataProp,
}: {
  sessionId: string
  turnId: number
  data?: MemorySnapshot['data']
}) {
  const [tab, setTab] = useState<Tab>('memories')
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
    fetch(`/api/memory/mem0/inspect?sessionId=${encodeURIComponent(sessionId)}`)
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

  const memories: Array<Mem0Memory> = Array.isArray((data as any)?.results)
    ? (data as any).results
    : Array.isArray(data)
      ? (data as Array<Mem0Memory>)
      : []

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-violet-500/30">
        <div className="text-sm font-semibold text-violet-300">mem0</div>
        <div className="text-xs text-gray-400">
          {loading ? 'refreshing…' : err ? `err: ${err}` : `${memories.length} memories`}
        </div>
      </div>
      <div className="flex gap-1 px-3 pt-2">
        {(['memories', 'raw'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-2 py-1 text-xs rounded ${
              tab === t
                ? 'bg-violet-500/30 text-violet-200'
                : 'text-gray-400 hover:text-violet-300'
            }`}
          >
            {t}
            {t === 'memories' && ` (${memories.length})`}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto px-3 py-2 text-xs">
        {tab === 'memories' && (
          <ul className="space-y-2">
            {memories.map((m, i) => (
              <li
                key={m.id ?? i}
                className="border border-violet-500/20 rounded p-2 bg-gray-900/40"
              >
                <div className="text-gray-200 whitespace-pre-wrap mb-1">
                  {m.memory ?? '(no memory text)'}
                </div>
                <div className="text-[10px] text-gray-500 flex gap-2 flex-wrap">
                  {m.user_id && <span>user: {m.user_id}</span>}
                  {m.run_id && <span>run: {m.run_id.slice(0, 8)}…</span>}
                  {m.updated_at && <span>{m.updated_at}</span>}
                </div>
              </li>
            ))}
            {memories.length === 0 && (
              <li className="text-gray-500 italic">No memories yet.</li>
            )}
          </ul>
        )}
        {tab === 'raw' && <RawJson data={data ?? null} />}
      </div>
    </div>
  )
}
