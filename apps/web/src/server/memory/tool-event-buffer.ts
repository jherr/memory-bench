import type { ToolRecallEvent, ToolRetainEvent } from '@tanstack/ai-memory'

interface Buffer {
  retains: Array<ToolRetainEvent>
  recalls: Array<ToolRecallEvent>
}

const buffers = new Map<string, Buffer>()

function getOrCreate(sessionId: string): Buffer {
  let buf = buffers.get(sessionId)
  if (!buf) {
    buf = { retains: [], recalls: [] }
    buffers.set(sessionId, buf)
  }
  return buf
}

export function toolEventSinkForSession(sessionId: string) {
  return {
    onToolRetain(event: ToolRetainEvent): void {
      getOrCreate(sessionId).retains.push(event)
    },
    onToolRecall(event: ToolRecallEvent): void {
      getOrCreate(sessionId).recalls.push(event)
    },
  }
}

export function drainToolEvents(sessionId: string): Buffer {
  const buf = buffers.get(sessionId)
  if (!buf) return { retains: [], recalls: [] }
  buffers.delete(sessionId)
  return buf
}
