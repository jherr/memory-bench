import type { EngineId, RecallResult, RetainReceipt } from '#/lib/memory/types'

export interface ToolRetainEvent {
  engine: EngineId
  receipt: RetainReceipt
}

export interface ToolRecallEvent {
  engine: EngineId
  query: string
  result: RecallResult
}

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

export function pushToolRetain(sessionId: string, ev: ToolRetainEvent): void {
  getOrCreate(sessionId).retains.push(ev)
}

export function pushToolRecall(sessionId: string, ev: ToolRecallEvent): void {
  getOrCreate(sessionId).recalls.push(ev)
}

export function drainToolEvents(sessionId: string): Buffer {
  const buf = buffers.get(sessionId)
  if (!buf) return { retains: [], recalls: [] }
  buffers.delete(sessionId)
  return buf
}
