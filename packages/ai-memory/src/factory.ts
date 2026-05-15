import type {
  EngineId,
  FactList,
  MemoryDriver,
  MemoryFact,
  MemorySnapshot,
  RecallResult,
  RetainInput,
  RetainReceipt,
  Scope,
} from './index'
import type {
  Consolidator,
  Extractor,
  Fact,
  FactStore,
  Renderer,
  ToolFactory,
} from './types/stages'
import { applyConsolidationDecisions } from './utils'

const DEFAULT_RECALL_LIMIT = 8

export interface ComposedDriverConfig<F extends Fact = Fact> {
  id: EngineId
  store: FactStore<F>
  extractor: Extractor
  consolidator: Consolidator
  renderer: Renderer
  tools?: ToolFactory<F>
  toolGuidance?: string
  recallLimit?: number
}

/**
 * Compose a driver from a set of stage implementations. The returned driver
 * satisfies the `MemoryDriver` contract used by the rest of the framework.
 *
 * Lifecycle inside the composed driver:
 *  - `retainTurn`: extractor -> consolidator -> applyConsolidationDecisions(store).
 *  - `recall`: store.searchFacts -> renderer -> assemble fragments + tools.
 *  - `inspect` / `listFacts`: drawn from `store.listFacts`.
 */
export function createComposedDriver<F extends Fact = Fact>(
  config: ComposedDriverConfig<F>,
): MemoryDriver {
  const recallLimit = config.recallLimit ?? DEFAULT_RECALL_LIMIT

  return {
    id: config.id,

    async retainTurn(scope: Scope, input: RetainInput): Promise<Array<RetainReceipt>> {
      const start = Date.now()
      try {
        const text = `User: ${input.user}\nAssistant: ${input.assistant}`
        const candidates = await config.extractor.extract(text, { scope })
        const decisions = await config.consolidator.consolidate(
          scope,
          candidates,
          config.store as FactStore,
        )
        await applyConsolidationDecisions(config.store, scope, decisions)
        return [
          {
            engine: config.id,
            ok: true,
            latencyMs: Date.now() - start,
            raw: { candidates, decisions },
          },
        ]
      } catch (err: any) {
        return [
          {
            engine: config.id,
            ok: false,
            latencyMs: Date.now() - start,
            raw: null,
            error: err?.message ?? String(err),
          },
        ]
      }
    },

    async recall(scope: Scope, query: string): Promise<RecallResult> {
      const tools = config.tools
        ? config.tools({ scope, store: config.store })
        : []
      const start = Date.now()
      try {
        const facts = await config.store.searchFacts(scope, {
          text: query,
          limit: recallLimit,
        })
        return {
          engine: config.id,
          latencyMs: Date.now() - start,
          systemPrompt: config.renderer.render(facts),
          fragments: facts.map((f) => ({
            text: f.text,
            source: `${config.id}#${f.id}`,
          })),
          tools,
          toolGuidance: config.toolGuidance ?? '',
          raw: { facts },
        }
      } catch (err: any) {
        return {
          engine: config.id,
          latencyMs: Date.now() - start,
          systemPrompt: '',
          fragments: [],
          tools,
          toolGuidance: config.toolGuidance ?? '',
          raw: { error: err?.message ?? String(err) },
        }
      }
    },

    async inspect(scope: Scope): Promise<MemorySnapshot> {
      const facts = await config.store.listFacts(scope, {
        includeSuperseded: true,
      })
      const active = facts.filter((f) => !f.supersededBy)
      const superseded = facts.filter((f) => Boolean(f.supersededBy))
      return {
        engine: config.id,
        takenAt: new Date().toISOString(),
        data: {
          memories: active.map((f) => ({
            id: f.id,
            content: f.text,
            source:
              (f.metadata?.source as string | undefined) ?? 'middleware',
            createdAt: f.createdAt.toISOString(),
            tags: f.tags ?? [],
            entities: f.entities ?? [],
          })),
          supersededCount: superseded.length,
          supersededChains: superseded.map((f) => ({
            id: f.id,
            content: f.text,
            supersededBy: f.supersededBy,
          })),
        },
      }
    },

    async listFacts(scope: Scope): Promise<FactList> {
      const facts = await config.store.listFacts(scope)
      const out: Array<MemoryFact> = facts.map((f) => ({
        id: `${config.id}-${f.id}`,
        text: f.text,
        source: (f.metadata?.source as string | undefined) ?? 'middleware',
        createdAt: f.createdAt.toISOString(),
      }))
      return {
        engine: config.id,
        facts: out,
        takenAt: new Date().toISOString(),
      }
    },
  }
}
