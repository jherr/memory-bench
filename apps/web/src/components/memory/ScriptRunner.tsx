import { useState } from 'react'

import { listScripts } from '#/lib/scripts/loader'
import type { Script } from '#/lib/scripts/types'

export type RunPlan =
  | { kind: 'single'; script: Script }
  | { kind: 'triple'; script: Script; sessionIds: Array<string>; runId: string }

export function ScriptRunner({
  isRunning,
  onStart,
  onCancel,
}: {
  isRunning: boolean
  onStart: (plan: RunPlan) => void
  onCancel: () => void
}) {
  const scripts = listScripts()
  const [scriptId, setScriptId] = useState<string>(scripts[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  const selected = scripts.find((s) => s.id === scriptId)

  const handleSingle = () => {
    if (!selected) return
    onStart({ kind: 'single', script: selected })
  }

  const handleTriple = async () => {
    if (!selected) return
    setBusy(true)
    try {
      const sessionIds = Array.from({ length: 3 }, () => crypto.randomUUID())
      const res = await fetch('/api/runs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId: selected.id, sessionIds }),
      })
      if (!res.ok) {
        alert(`run x3 failed: HTTP ${res.status}`)
        return
      }
      const { runId } = (await res.json()) as { runId: string }
      onStart({ kind: 'triple', script: selected, sessionIds, runId })
    } finally {
      setBusy(false)
    }
  }

  if (scripts.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic">no scripts loaded</div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <select
        value={scriptId}
        onChange={(e) => setScriptId(e.target.value)}
        disabled={isRunning || busy}
        className="bg-gray-800 border border-orange-500/20 rounded px-2 py-1 text-gray-200"
      >
        {scripts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
      {isRunning ? (
        <button
          onClick={onCancel}
          className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white"
        >
          cancel
        </button>
      ) : (
        <>
          <button
            onClick={handleSingle}
            disabled={busy || !selected}
            className="px-2 py-1 rounded bg-orange-500/30 hover:bg-orange-500/40 text-orange-200"
          >
            run
          </button>
          <button
            onClick={handleTriple}
            disabled={busy || !selected}
            className="px-2 py-1 rounded bg-orange-500/30 hover:bg-orange-500/40 text-orange-200"
          >
            run × 3
          </button>
        </>
      )}
    </div>
  )
}
