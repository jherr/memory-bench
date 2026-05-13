export type EngineId = 'hindsight' | 'mem0' | 'honcho'

export const ENGINE_IDS: ReadonlyArray<EngineId> = ['hindsight', 'mem0', 'honcho']

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
  fragments: Array<RecallFragment>
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

export interface MemoryEngine {
  id: EngineId
  retainTurn(scope: Scope, input: RetainInput): Promise<Array<RetainReceipt>>
  recall(scope: Scope, query: string): Promise<RecallResult>
  inspect(scope: Scope): Promise<MemorySnapshot>
  listFacts(scope: Scope): Promise<FactList>
}
