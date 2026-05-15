import type { Scope } from './index'
import type {
  ConsolidationDecision,
  Fact,
  FactStore,
} from './types/stages'

/**
 * Apply a list of consolidation decisions against a FactStore.
 *
 * - `insert`: create a new Fact (assigning id + createdAt) and store it.
 * - `merge`: shallow-merge the merged candidate over the existing Fact (id preserved).
 * - `supersede`: create a replacement Fact, then mark the existing one as superseded.
 * - `skip`: no-op.
 *
 * The store is responsible for persistence. This helper is intentionally
 * minimal — it does not call the consolidator, embedder, or extractor.
 */
export async function applyConsolidationDecisions<F extends Fact = Fact>(
  store: FactStore<F>,
  scope: Scope,
  decisions: Array<ConsolidationDecision>,
): Promise<void> {
  for (const decision of decisions) {
    switch (decision.action) {
      case 'insert': {
        const fact = {
          ...decision.fact,
          id: crypto.randomUUID(),
          createdAt: new Date(),
        } as F
        await store.storeFact(scope, fact)
        break
      }
      case 'merge': {
        const existing = await store.getFact(scope, decision.existingId)
        if (!existing) break
        const merged = { ...existing, ...decision.merged } as F
        await store.storeFact(scope, merged)
        break
      }
      case 'supersede': {
        const existing = await store.getFact(scope, decision.existingId)
        if (!existing) break
        const replacement = {
          ...decision.replacement,
          id: crypto.randomUUID(),
          createdAt: new Date(),
        } as F
        await store.storeFact(scope, replacement)
        await store.storeFact(scope, {
          ...existing,
          supersededBy: replacement.id,
        } as F)
        break
      }
      case 'skip':
        break
    }
  }
}
