import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import type {
  CandidateFact,
  ConsolidationDecision,
  Consolidator,
  Fact,
  FactStore,
  Scope,
} from '@tanstack/ai-memory'

const DEFAULT_MODEL = 'claude-haiku-4-5'
const DEFAULT_SEARCH_LIMIT = 5
/**
 * Port of TanMemory's `MERGE_SIM_GATE`: skip the LLM consolidation step
 * unless the best neighbor is at least this similar. Below the gate we
 * always insert without calling the LLM.
 */
const DEFAULT_SIMILARITY_THRESHOLD = 0.75

const CONSOLIDATE_SYSTEM = `You decide how to incorporate a new fact into existing memory. For each new fact you'll see up to 5 similar existing memories with their numeric ids. Decide exactly one of:

- "insert": the new fact is genuinely new information not covered by the existing memories.
- "merge": the new fact updates, refines, or restates one of the existing memories. Pick the most relevant existing id and write a single combined fact that preserves both old and new information. The merged text should be a single concise sentence.
- "skip": the new fact is already fully covered by an existing memory (a near-duplicate). Optionally provide a brief reason.

Be conservative: prefer "merge" when there's clear overlap, prefer "insert" when in doubt. Only "skip" when the new fact adds nothing.`

const RawDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('insert') }),
  z.object({
    action: z.literal('merge'),
    intoId: z.string(),
    newText: z.string().min(1),
  }),
  z.object({ action: z.literal('skip'), reason: z.string().optional() }),
])

export interface SimpleConsolidatorConfig {
  apiKey: string
  model?: string
  searchLimit?: number
  /**
   * Similarity gate below which we skip the LLM and insert directly.
   * Defaults to 0.75 to match the legacy TanMemory `MERGE_SIM_GATE`.
   */
  similarityThreshold?: number
}

/**
 * Simple consolidator that mirrors TanMemory's logic:
 *  1. For each candidate, search the store for up to `searchLimit` similar facts.
 *  2. If no neighbors or the best is below `similarityThreshold`, insert.
 *  3. Otherwise ask the LLM whether to insert / merge / skip.
 *
 * Neighbor similarity is read from `fact.metadata.similarity` (populated by
 * `createSqliteFactStore.searchFacts`). Stores that don't populate it are
 * treated as "no similarity info available" and always go through the LLM.
 */
export function createSimpleConsolidator(
  config: SimpleConsolidatorConfig,
): Consolidator {
  const model = config.model ?? DEFAULT_MODEL
  const searchLimit = config.searchLimit ?? DEFAULT_SEARCH_LIMIT
  const similarityThreshold =
    config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD
  const client = new Anthropic({ apiKey: config.apiKey })

  return {
    async consolidate(
      scope: Scope,
      candidates: Array<CandidateFact>,
      store: FactStore,
    ): Promise<Array<ConsolidationDecision>> {
      const decisions: Array<ConsolidationDecision> = []
      for (const candidate of candidates) {
        const neighbors = await store.searchFacts(scope, {
          text: candidate.text,
          limit: searchLimit,
        })
        const bestSim = topSimilarity(neighbors)
        if (neighbors.length === 0 || bestSim < similarityThreshold) {
          decisions.push({ action: 'insert', fact: candidate })
          continue
        }
        const decision = await askLLM(client, model, candidate, neighbors)
        decisions.push(decision)
      }
      return decisions
    },
  }
}

function topSimilarity(facts: Array<Fact>): number {
  let best = 0
  for (const f of facts) {
    const s = f.metadata?.similarity
    if (typeof s === 'number' && s > best) best = s
  }
  // If no similarity metadata was set anywhere, return Infinity so the LLM
  // is always consulted (cannot be sure the candidate is novel).
  if (best === 0 && facts.length > 0) {
    const anyHasSimilarity = facts.some(
      (f) => typeof f.metadata?.similarity === 'number',
    )
    if (!anyHasSimilarity) return Number.POSITIVE_INFINITY
  }
  return best
}

async function askLLM(
  client: Anthropic,
  model: string,
  candidate: CandidateFact,
  neighbors: Array<Fact>,
): Promise<ConsolidationDecision> {
  const neighborList = neighbors
    .map((n) => {
      const sim = n.metadata?.similarity
      const simStr = typeof sim === 'number' ? sim.toFixed(2) : 'n/a'
      return `  id=${n.id} (sim=${simStr}): ${n.text}`
    })
    .join('\n')

  const res = await client.messages.create({
    model,
    max_tokens: 512,
    system: CONSOLIDATE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `New fact:\n  ${candidate.text}\n\nExisting memories:\n${neighborList}\n\nReturn JSON in one of these exact shapes:\n  {"action": "insert"}\n  {"action": "merge", "intoId": "<id>", "newText": "<merged sentence>"}\n  {"action": "skip", "reason": "<optional>"}\n\nOutput ONLY the JSON, no prose.`,
      },
    ],
  })
  const raw = textOf(res)
  const json = extractJsonBlock(raw)
  if (!json) return { action: 'insert', fact: candidate }
  try {
    const decision = RawDecisionSchema.parse(JSON.parse(json))
    if (decision.action === 'insert') {
      return { action: 'insert', fact: candidate }
    }
    if (decision.action === 'skip') {
      return {
        action: 'skip',
        candidate,
        reason: decision.reason ?? 'duplicate',
      }
    }
    // merge: produce a supersede decision so the old fact is retained as a
    // history record and a new merged fact takes its place. This matches the
    // TanMemory behavior of writing a new row and marking the old one as
    // superseded_by.
    return {
      action: 'supersede',
      existingId: decision.intoId,
      replacement: {
        ...candidate,
        text: decision.newText,
        metadata: {
          ...(candidate.metadata ?? {}),
          source: 'consolidation',
          mergedFrom: decision.intoId,
        },
      },
    }
  } catch {
    return { action: 'insert', fact: candidate }
  }
}

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

function extractJsonBlock(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return trimmed
  const match = trimmed.match(/\{[\s\S]*\}/)
  return match ? match[0] : null
}
