import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { fetchServerSentEvents, useChat } from '@tanstack/ai-react'
import type { UIMessage } from '@tanstack/ai-react'

import type { EngineId, RetainReceipt } from '#/lib/memory/types'

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
}: {
  sessionId: string
  engineId: EngineId
  onTurnComplete: (turnId: number, receipts: Array<RetainReceipt>) => void
  autoplay?: {
    messages: Array<string>
    interTurnDelayMs?: number
    onDone?: () => void
  }
}) {
  const [input, setInput] = useState('')
  const pendingUserRef = useRef<string>('')
  const autoplayIdxRef = useRef(0)
  const lastIsLoadingRef = useRef(false)

  const { messages, sendMessage, isLoading } = useChat({
    connection: fetchServerSentEvents('/api/chat'),
    body: { sessionId, engineId },
    onFinish: async (assistantMessage) => {
      const assistantText = extractText(assistantMessage.parts)
      const userMsg = pendingUserRef.current
      pendingUserRef.current = ''
      if (!userMsg || !assistantText) return
      try {
        const res = await fetch('/api/memory/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            userMsg,
            assistantReply: assistantText,
            activeEngineId: engineId,
          }),
        })
        if (!res.ok) {
          console.error('[ChatPanel] turn POST failed:', res.status)
          return
        }
        const data = (await res.json()) as {
          turnId: number
          receipts: Array<RetainReceipt>
        }
        onTurnComplete(data.turnId, data.receipts)
      } catch (err) {
        console.error('[ChatPanel] turn POST error:', err)
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    pendingUserRef.current = text
    setInput('')
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
      <form
        onSubmit={handleSubmit}
        className="border-t border-orange-500/20 px-4 py-3 flex gap-2"
      >
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
    </div>
  )
}
