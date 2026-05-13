import { useEffect, useState } from 'react'

import { RawJson } from './RawJson'
import type { MemorySnapshot } from '#/lib/memory/types'

type Tab = 'messages' | 'queue' | 'summaries' | 'raw'

type HonchoMessage = {
  id?: string
  peerId?: string
  content?: string
  createdAt?: string
}

export function HonchoPanel({
  sessionId,
  turnId,
  data: dataProp,
}: {
  sessionId: string
  turnId: number
  data?: MemorySnapshot['data']
}) {
  const [tab, setTab] = useState<Tab>('messages')
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
    fetch(`/api/memory/honcho/inspect?sessionId=${encodeURIComponent(sessionId)}`)
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

  const messages: Array<HonchoMessage> = Array.isArray((data as any)?.messages)
    ? (data as any).messages
    : []
  const queueStatus = (data as any)?.queueStatus
  const summaries = (data as any)?.summaries
  const isDeriving =
    queueStatus &&
    typeof queueStatus === 'object' &&
    'pendingWorkUnits' in queueStatus &&
    Number(queueStatus.pendingWorkUnits ?? queueStatus.pending_work_units ?? 0) > 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-emerald-500/30">
        <div className="text-sm font-semibold text-emerald-300">honcho</div>
        <div className="text-xs text-gray-400">
          {loading
            ? 'refreshing…'
            : err
              ? `err: ${err}`
              : isDeriving
                ? '(deriving…)'
                : `${messages.length} msgs`}
        </div>
      </div>
      <div className="flex gap-1 px-3 pt-2">
        {(['messages', 'queue', 'summaries', 'raw'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-2 py-1 text-xs rounded ${
              tab === t
                ? 'bg-emerald-500/30 text-emerald-200'
                : 'text-gray-400 hover:text-emerald-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto px-3 py-2 text-xs">
        {tab === 'messages' && (
          <ul className="space-y-2">
            {messages.map((m, i) => (
              <li
                key={m.id ?? i}
                className="border border-emerald-500/20 rounded p-2 bg-gray-900/40"
              >
                <div className="text-[10px] text-gray-500 mb-1">
                  {m.peerId} · {m.createdAt ?? ''}
                </div>
                <div className="text-gray-200 whitespace-pre-wrap">
                  {m.content ?? '(empty)'}
                </div>
              </li>
            ))}
            {messages.length === 0 && (
              <li className="text-gray-500 italic">No messages yet.</li>
            )}
          </ul>
        )}
        {tab === 'queue' && <RawJson data={queueStatus ?? null} />}
        {tab === 'summaries' && <RawJson data={summaries ?? null} />}
        {tab === 'raw' && <RawJson data={data ?? null} />}
      </div>
    </div>
  )
}
