import type { Tool } from '@tanstack/ai'

export type EngineId = 'hindsight' | 'mem0' | 'honcho' | 'tanmemory'

export const ENGINE_IDS: ReadonlyArray<EngineId> = [
  'hindsight',
  'mem0',
  'honcho',
  'tanmemory',
]

export interface Scope {
  sessionId: string
  userId?: string
}

export interface RetainInput {
  user: string
  assistant: string
}

export interface RetainReceipt {
  engine: EngineId
  ok: boolean
  latencyMs: number
  raw: unknown
  error?: string
}

export interface RecallFragment {
  text: string
  source: string
}

export interface RecallResult {
  engine: EngineId
  latencyMs: number
  /** Pre-rendered block ready to drop into the LLM system prompt. */
  systemPrompt: string
  /** Discrete items when the engine produces them; omitted for synthesized output. */
  fragments?: Array<RecallFragment>
  /** Tools the engine recommends exposing to the LLM. Empty for engines that don't expose tools. */
  tools: Array<Tool>
  /** System prompt addition that explains when/how to use the tools. Empty when tools is empty. */
  toolGuidance: string
  raw: unknown
}

export interface MemorySnapshot {
  engine: EngineId
  takenAt: string
  data: unknown
}

export interface MemoryFact {
  id: string
  text: string
  source?: string
  createdAt?: string
}

export interface FactList {
  engine: EngineId
  facts: Array<MemoryFact>
  takenAt: string
}

export interface MemoryDriver {
  id: EngineId
  retainTurn(scope: Scope, input: RetainInput): Promise<Array<RetainReceipt>>
  recall(scope: Scope, query: string): Promise<RecallResult>
  inspect(scope: Scope): Promise<MemorySnapshot>
  listFacts(scope: Scope): Promise<FactList>
}
