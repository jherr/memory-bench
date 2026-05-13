import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Send } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { fetchServerSentEvents, useChat } from '@tanstack/ai-react'
import type { UIMessage } from '@tanstack/ai-react'

import type { EngineId, RetainReceipt } from '#/lib/memory/types'

type LastRecall = {
  sessionId: string
  engineId: EngineId
  query: string
  fragments: Array<{ text: string; source: string }>
  latencyMs: number
  systemPrompt: string
  takenAt: string
}

function extractText(parts: UIMessage['parts'] | undefined): string {
  if (!parts) return ''
  return parts
    .filter((p: any) => p.type === 'text' && p.content)
    .map((p: any) => p.content as string)
    .join('\n')
}

export function ChatPanel({
  sessionId,
  engineId,
  onTurnComplete,
  autoplay,
  seedPrompts,
}: {
  sessionId: string
  engineId: EngineId
  onTurnComplete: (turnId: number, receipts: Array<RetainReceipt>) => void
  autoplay?: {
    messages: Array<string>
    interTurnDelayMs?: number
    onDone?: () => void
  }
  seedPrompts?: Array<{ label: string; text: string }>
}) {
  const [input, setInput] = useState('')
  const [lastRecall, setLastRecall] = useState<LastRecall | null>(null)
  const [recallExpanded, setRecallExpanded] = useState(false)
  const pendingUserRef = useRef<string>('')
  const lastSeenTurnIdRef = useRef(0)
  const autoplayIdxRef = useRef(0)
  const lastIsLoadingRef = useRef(false)

  const { messages, sendMessage, isLoading } = useChat({
    connection: fetchServerSentEvents('/api/chat'),
    body: { sessionId, engineId },
    onFinish: async (assistantMessage) => {
      const assistantText = extractText(assistantMessage.parts)
      pendingUserRef.current = ''
      if (!assistantText) return
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        try {
          const r = await fetch(
            `/api/debug/last-turn?sessionId=${encodeURIComponent(sessionId)}`,
          )
          if (r.ok) {
            const { entry } = (await r.json()) as {
              entry: {
                turnId: number
                receipts: Array<RetainReceipt>
                takenAt: string
              } | null
            }
            if (entry && entry.turnId > lastSeenTurnIdRef.current) {
              lastSeenTurnIdRef.current = entry.turnId
              onTurnComplete(entry.turnId, entry.receipts)
              return
            }
          }
        } catch {
          // best-effort, keep polling
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    },
  })

  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (!autoplay) {
      autoplayIdxRef.current = 0
      lastIsLoadingRef.current = false
      return
    }
    const prev = lastIsLoadingRef.current
    lastIsLoadingRef.current = isLoading
    const streamJustEnded = prev && !isLoading
    const isFirst = autoplayIdxRef.current === 0 && !prev
    if (!isFirst && !streamJustEnded) return
    if (autoplayIdxRef.current >= autoplay.messages.length) {
      autoplay.onDone?.()
      return
    }
    const next = autoplay.messages[autoplayIdxRef.current]
    autoplayIdxRef.current += 1
    const delay = autoplay.interTurnDelayMs ?? 800
    const handle = setTimeout(() => {
      pendingUserRef.current = next
      void sendMessage(next)
    }, delay)
    return () => clearTimeout(handle)
  }, [autoplay, isLoading, sendMessage])

  useEffect(() => {
    if (!isLoading) return
    let cancelled = false
    const prevTakenAt = lastRecall?.takenAt ?? ''
    const poll = async () => {
      while (!cancelled) {
        try {
          const r = await fetch(
            `/api/debug/last-recall?sessionId=${encodeURIComponent(sessionId)}`,
          )
          if (r.ok) {
            const { entry } = (await r.json()) as {
              entry: LastRecall | null
            }
            if (entry && entry.takenAt !== prevTakenAt) {
              if (!cancelled) setLastRecall(entry)
              return
            }
          }
        } catch {
          // best-effort, keep polling
        }
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    void poll()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, sessionId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    pendingUserRef.current = text
    setInput('')
    void sendMessage(text)
  }

  const handleSeed = (text: string) => {
    if (isLoading) return
    pendingUserRef.current = text
    void sendMessage(text)
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={containerRef} className="flex-1 overflow-auto px-4 py-2">
        {messages.length === 0 && (
          <div className="text-gray-500 italic text-sm py-8 text-center">
            Start chatting. Every turn is fanned out to all enabled memory engines.
          </div>
        )}
        {messages.map((m) => {
          const text = extractText(m.parts)
          if (!text) return null
          return (
            <div
              key={m.id}
              className={`p-3 rounded mb-2 ${
                m.role === 'assistant'
                  ? 'bg-linear-to-r from-orange-500/5 to-red-600/5'
                  : 'bg-gray-800/30'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                {m.role}
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Streamdown>{text}</Streamdown>
              </div>
            </div>
          )
        })}
      </div>
      <div className="border-t border-orange-500/20">
        {lastRecall && (
          <div className="px-4 pt-2 text-[10px] text-gray-400 border-b border-orange-500/10">
            <button
              type="button"
              onClick={() => setRecallExpanded((v) => !v)}
              className="w-full flex items-center gap-1 hover:text-orange-200 py-1"
            >
              {recallExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <span>
                last recall:{' '}
                <span className="text-orange-300">{lastRecall.engineId}</span>{' '}
                · {lastRecall.fragments.length} fragment
                {lastRecall.fragments.length === 1 ? '' : 's'} ·{' '}
                {lastRecall.latencyMs}ms
              </span>
            </button>
            {recallExpanded && (
              <div className="pb-2 space-y-2">
                <div className="text-gray-500">
                  query:{' '}
                  <span className="text-gray-300 font-mono">
                    {lastRecall.query}
                  </span>
                </div>
                {lastRecall.fragments.length === 0 ? (
                  <div className="italic text-gray-500">
                    No fragments recalled — the engine returned nothing relevant
                    to this query. The LLM will have no prior context to work
                    with.
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {lastRecall.fragments.map((f, i) => (
                      <li
                        key={i}
                        className="flex gap-2 border border-orange-500/10 rounded p-1.5 bg-gray-900/40"
                      >
                        <span className="text-gray-500 shrink-0">
                          ({f.source})
                        </span>
                        <span className="text-gray-200 break-words">
                          {f.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <details className="text-gray-500">
                  <summary className="cursor-pointer hover:text-orange-200">
                    full system prompt
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap text-gray-300 bg-gray-900/60 p-2 rounded text-[10px] max-h-48 overflow-auto">
                    {lastRecall.systemPrompt}
                  </pre>
                </details>
              </div>
            )}
          </div>
        )}
        <form onSubmit={handleSubmit} className="px-4 pt-3 pb-2 flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            disabled={isLoading}
            rows={1}
            className="flex-1 rounded border border-orange-500/20 bg-gray-800/50 px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500/50 resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e as any)
              }
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-2 text-orange-500 hover:text-orange-400 disabled:text-gray-500"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        {seedPrompts && seedPrompts.length > 0 && (
          <div className="px-4 pb-2 overflow-x-auto flex gap-1">
            {seedPrompts.map((p, i) => (
              <button
                key={`${p.label}-${i}`}
                type="button"
                onClick={() => handleSeed(p.text)}
                disabled={isLoading}
                title={p.text}
                className="shrink-0 max-w-[200px] truncate text-[10px] px-2 py-1 rounded border border-orange-500/20 text-gray-300 hover:text-orange-200 hover:border-orange-500/40 bg-gray-800/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
