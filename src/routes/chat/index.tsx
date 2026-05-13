import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { ChatPanel } from '#/components/memory/ChatPanel'
import { EngineSelector } from '#/components/memory/EngineSelector'
import { InspectorHost } from '#/components/memory/InspectorHost'
import { ModeToggle } from '#/components/memory/ModeToggle'
import { ScriptRunner } from '#/components/memory/ScriptRunner'
import type { RunPlan } from '#/components/memory/ScriptRunner'
import { TurnTimeline } from '#/components/memory/TurnTimeline'
import { useSessionId } from '#/lib/memory/useSessionId'
import type { EngineId } from '#/lib/memory/types'
import { ENGINE_IDS } from '#/lib/memory/types'

const ENABLED: Record<EngineId, boolean> = {
  hindsight: true,
  mem0: true,
  honcho: true,
}

type RunState = {
  plan: RunPlan
  currentIdx: number
}

function ChatBenchPage() {
  const navigate = useNavigate()
  const nativeSessionId = useSessionId()
  const [active, setActive] = useState<EngineId>('hindsight')
  const [turnId, setTurnId] = useState(0)
  const [mode, setMode] = useState<'explorer' | 'scientist'>('explorer')
  const [run, setRun] = useState<RunState | null>(null)

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
      <div className="flex items-center justify-center h-screen text-gray-400">
        loading session…
      </div>
    )
  }

  const handleStart = (plan: RunPlan) => {
    setRun({ plan, currentIdx: 0 })
    if (plan.kind === 'triple') setTurnId(0)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-gray-900 text-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-orange-500/20">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-bold bg-linear-to-r from-orange-500 to-red-600 text-transparent bg-clip-text">
            memory-bench
          </h1>
          <EngineSelector
            active={effectiveEngine}
            onChange={setActive}
            enabled={ENABLED}
            locked={engineLocked || !!run}
          />
          <ModeToggle mode={mode} onChange={setMode} hasTurns={turnId > 0} />
          <ScriptRunner
            isRunning={!!run}
            onStart={handleStart}
            onCancel={() => setRun(null)}
          />
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
      <div className="border-b border-orange-500/10">
        <TurnTimeline
          key={activeSessionId}
          sessionId={activeSessionId}
          refreshKey={turnId}
        />
      </div>
      <div className="flex-1 grid grid-cols-[1fr_420px] min-h-0">
        <div className="border-r border-orange-500/20 min-h-0">
          <ChatPanel
            key={activeSessionId}
            sessionId={activeSessionId}
            engineId={effectiveEngine}
            onTurnComplete={(t) => setTurnId(t)}
            autoplay={autoplay}
          />
        </div>
        <div className="min-h-0">
          <InspectorHost
            engineId={effectiveEngine}
            sessionId={activeSessionId}
            turnId={turnId}
          />
        </div>
      </div>
      <div className="border-t border-orange-500/10 px-4 py-1 text-[10px] text-gray-500 flex gap-3">
        {ENGINE_IDS.map((id) => (
          <span key={id} className={ENABLED[id] ? '' : 'opacity-40'}>
            {id}: {ENABLED[id] ? 'wired' : 'not yet'}
          </span>
        ))}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/chat/')({
  component: ChatBenchPage,
})
