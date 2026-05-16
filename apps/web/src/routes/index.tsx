import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'

import { ChatPanel } from '#/components/memory/ChatPanel'
import { EngineSelector } from '#/components/memory/EngineSelector'
import { MemoryPanel } from '#/components/memory/MemoryPanel'
import { resetSessionId, useSessionId } from '#/lib/memory/useSessionId'
import type { EngineId } from '@tanstack/ai-memory'
import { ENGINE_IDS } from '@tanstack/ai-memory'

const ENABLED: Record<EngineId, boolean> = {
  hindsight: true,
  mem0: true,
  honcho: true,
  local: true,
}

const ENGINE_LIST = ENGINE_IDS.join(', ')

function SimpleChatPage() {
  const sessionId = useSessionId()
  const [engineId, setEngineId] = useState<EngineId>('local')
  const [memoryEnabled, setMemoryEnabled] = useState(true)
  const [turnId, setTurnId] = useState(0)
  const [resetting, setResetting] = useState(false)

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center min-h-svh bg-gray-900 text-gray-400">
        loading session…
      </div>
    )
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
            chat
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              memory:
            </span>
            <div className="flex gap-1" role="group" aria-label="memory toggle">
              <button
                type="button"
                onClick={() => setMemoryEnabled(true)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  memoryEnabled
                    ? 'bg-linear-to-r from-emerald-500/80 to-teal-600/80 text-white'
                    : 'bg-gray-800/50 text-gray-400 border border-orange-500/10 hover:text-orange-300'
                }`}
                title="Use the selected provider for recall + retain"
              >
                on
              </button>
              <button
                type="button"
                onClick={() => setMemoryEnabled(false)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  !memoryEnabled
                    ? 'bg-linear-to-r from-amber-500/80 to-orange-600/80 text-white'
                    : 'bg-gray-800/50 text-gray-400 border border-orange-500/10 hover:text-orange-300'
                }`}
                title="Bypass memory — chat against the bare LLM for an A/B demo"
              >
                off
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              provider:
            </span>
            <EngineSelector
              active={engineId}
              onChange={setEngineId}
              enabled={ENABLED}
              locked={!memoryEnabled}
            />
          </div>
          <button
            type="button"
            onClick={handleResetAll}
            disabled={resetting}
            className="px-3 py-1 rounded text-xs font-medium border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            title={`Wipe all memory across ${ENGINE_LIST} and local data dirs`}
          >
            {resetting ? 'resetting…' : 'Reset'}
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 font-mono">
          <Link
            to="/memory-bench"
            className="text-orange-300 hover:text-orange-200 underline-offset-2 hover:underline"
          >
            memory-bench →
          </Link>
          <span>session: {sessionId.slice(0, 8)}…</span>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-4 min-h-0 min-w-0">
        <div className="col-span-3 border-r border-orange-500/20 min-w-0 min-h-0">
          <ChatPanel
            key={`${sessionId}:${engineId}`}
            sessionId={sessionId}
            engineId={engineId}
            memoryEnabled={memoryEnabled}
            chatEndpoint="/api/simple-chat"
            onTurnComplete={(t) => setTurnId(t)}
          />
        </div>
        <div className="col-span-1 min-w-0 min-h-0">
          <MemoryPanel
            engineId={engineId}
            sessionId={sessionId}
            turnId={turnId}
          />
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/')({
  component: SimpleChatPage,
})
