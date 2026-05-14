import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { ChatPanel } from '#/components/memory/ChatPanel'
import { EngineSelector } from '#/components/memory/EngineSelector'
import { MemoryPanel } from '#/components/memory/MemoryPanel'
import { ModeToggle } from '#/components/memory/ModeToggle'
import { ScriptRunner } from '#/components/memory/ScriptRunner'
import type { RunPlan } from '#/components/memory/ScriptRunner'
import { TurnTimeline } from '#/components/memory/TurnTimeline'
import { resetSessionId, useSessionId } from '#/lib/memory/useSessionId'
import { listScripts } from '#/lib/scripts/loader'
import type { EngineId } from '#/lib/memory/types'
import { ENGINE_IDS } from '#/lib/memory/types'

const ENABLED: Record<EngineId, boolean> = {
  hindsight: true,
  mem0: true,
  honcho: true,
  tanmemory: true,
}

const ENGINE_LABELS: Record<EngineId, string> = {
  hindsight: 'Hindsight',
  mem0: 'mem0',
  honcho: 'Honcho',
  tanmemory: 'TanMemory',
}

const ENGINE_LIST = ENGINE_IDS.map((id) => ENGINE_LABELS[id]).join(', ')

type RunState = {
  plan: RunPlan
  currentIdx: number
}

function ChatBenchPage() {
  const navigate = useNavigate()
  const nativeSessionId = useSessionId()
  const [active, setActive] = useState<EngineId>('mem0')
  const [turnId, setTurnId] = useState(0)
  const [mode, setMode] = useState<'explorer' | 'scientist'>('explorer')
  const [run, setRun] = useState<RunState | null>(null)
  const [resetting, setResetting] = useState(false)

  const seedPrompts = useMemo(
    () =>
      listScripts().flatMap((s) =>
        s.turns.map((t, i) => ({
          label: `${s.id.split('-')[0]} ${i + 1}`,
          text: t.user,
        })),
      ),
    [],
  )

  const activeSessionId =
    run && run.plan.kind === 'triple'
      ? run.plan.sessionIds[run.currentIdx]
      : nativeSessionId

  const engineLocked = mode === 'scientist' && turnId > 0
  const effectiveEngine =
    run && run.plan.kind === 'triple' ? run.plan.script.activeEngine : active

  const autoplay = useMemo(() => {
    if (!run) return undefined
    return {
      messages: run.plan.script.turns.map((t) => t.user),
      interTurnDelayMs: run.plan.script.options.interTurnDelayMs,
      onDone: () => {
        if (run.plan.kind === 'single') {
          setRun(null)
          return
        }
        const nextIdx = run.currentIdx + 1
        if (nextIdx >= run.plan.sessionIds.length) {
          const runId = run.plan.runId
          setRun(null)
          setTurnId(0)
          navigate({ to: '/runs/$runId', params: { runId } })
        } else {
          setRun({ plan: run.plan, currentIdx: nextIdx })
          setTurnId(0)
        }
      },
    }
  }, [run, navigate])

  if (!nativeSessionId || !activeSessionId) {
    return (
      <div className="flex items-center justify-center min-h-svh bg-gray-900 text-gray-400">
        loading session…
      </div>
    )
  }

  const handleStart = (plan: RunPlan) => {
    setRun({ plan, currentIdx: 0 })
    if (plan.kind === 'triple') setTurnId(0)
  }

  const handleResetAll = async () => {
    if (
      !window.confirm(
        `Reset all memories? This deletes every fact in ${ENGINE_LIST} and rotates your session.`,
      )
    ) {
      return
    }
    setResetting(true)
    try {
      const res = await fetch('/api/sessions/reset', { method: 'POST' })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        window.alert(`Reset failed: ${res.status} ${text}`)
        return
      }
      resetSessionId()
      window.location.reload()
    } catch (err) {
      window.alert(`Reset error: ${(err as Error).message}`)
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-svh h-svh bg-gray-900 text-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-orange-500/20 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-bold bg-linear-to-r from-orange-500 to-red-600 text-transparent bg-clip-text">
            memory-bench
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              recall:
            </span>
            <EngineSelector
              active={effectiveEngine}
              onChange={setActive}
              enabled={ENABLED}
              locked={engineLocked || !!run}
            />
          </div>
          <ModeToggle mode={mode} onChange={setMode} hasTurns={turnId > 0} />
          <ScriptRunner
            isRunning={!!run}
            onStart={handleStart}
            onCancel={() => setRun(null)}
          />
          <button
            type="button"
            onClick={handleResetAll}
            disabled={resetting || !!run}
            className="px-3 py-1 rounded text-xs font-medium border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            title={`Wipe all memory across ${ENGINE_LIST} and local data dirs`}
          >
            {resetting ? 'resetting…' : 'Reset all'}
          </button>
        </div>
        <div className="text-xs text-gray-500 font-mono">
          session: {activeSessionId.slice(0, 8)}…
          {run?.plan.kind === 'triple' && (
            <span className="ml-2 text-orange-300">
              run {run.currentIdx + 1}/{run.plan.sessionIds.length}
            </span>
          )}
        </div>
      </div>
      <div className="border-b border-orange-500/10 shrink-0">
        <TurnTimeline
          key={activeSessionId}
          sessionId={activeSessionId}
          refreshKey={turnId}
        />
      </div>
      <div className="flex-1 grid grid-cols-[2fr_1fr_1fr_1fr] min-h-0 min-w-0">
        <div className="border-r border-orange-500/20 min-w-0 min-h-0">
          <ChatPanel
            key={activeSessionId}
            sessionId={activeSessionId}
            engineId={effectiveEngine}
            onTurnComplete={(t) => setTurnId(t)}
            autoplay={autoplay}
            seedPrompts={seedPrompts}
          />
        </div>
        {ENGINE_IDS.map((id, i) => (
          <div
            key={id}
            className={`min-w-0 min-h-0 ${
              i < ENGINE_IDS.length - 1 ? 'border-r border-orange-500/10' : ''
            }`}
          >
            <MemoryPanel
              engineId={id}
              sessionId={activeSessionId}
              turnId={turnId}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/')({
  component: ChatBenchPage,
})
