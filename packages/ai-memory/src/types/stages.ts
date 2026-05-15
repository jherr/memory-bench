import type { Tool } from '@tanstack/ai'

import type { Scope } from '../index'

export interface CandidateFact {
  text: string
  tags?: Array<string>
  entities?: Array<string>
  metadata?: Record<string, unknown>
}

export interface Fact extends CandidateFact {
  id: string
  createdAt: Date
  supersededBy?: string
}

export interface FactFilter {
  tags?: Array<string>
  entities?: Array<string>
  createdAfter?: Date
  createdBefore?: Date
  includeSuperseded?: boolean
}

export interface FactQuery {
  text?: string
  filter?: FactFilter
  limit?: number
  hints?: Record<string, unknown>
}

export interface FactStore<F extends Fact = Fact> {
  storeFact(scope: Scope, fact: F): Promise<void>
  getFact(scope: Scope, id: string): Promise<F | null>
  searchFacts(scope: Scope, query: FactQuery): Promise<Array<F>>
  listFacts(scope: Scope, filter?: FactFilter): Promise<Array<F>>
  deleteFact(scope: Scope, id: string): Promise<void>
}

export interface Embedder {
  embed(texts: Array<string>): Promise<Array<Float32Array>>
}

export interface ExtractContext {
  scope: Scope
  metadata?: Record<string, unknown>
}

export interface Extractor {
  extract(text: string, ctx?: ExtractContext): Promise<Array<CandidateFact>>
}

export type ConsolidationDecision =
  | { action: 'insert'; fact: CandidateFact }
  | { action: 'merge'; existingId: string; merged: CandidateFact }
  | { action: 'supersede'; existingId: string; replacement: CandidateFact }
  | { action: 'skip'; candidate: CandidateFact; reason: string }

export interface Consolidator {
  consolidate(
    scope: Scope,
    candidates: Array<CandidateFact>,
    store: FactStore,
  ): Promise<Array<ConsolidationDecision>>
}

export interface Renderer {
  render(facts: Array<Fact>): string
}

export type ToolFactory<F extends Fact = Fact> = (ctx: {
  scope: Scope
  store: FactStore<F>
}) => Array<Tool>
