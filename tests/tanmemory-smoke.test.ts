/**
 * Live end-to-end smoke test for the TanMemory engine.
 *
 * Skipped automatically unless both OPENAI_API_KEY and ANTHROPIC_API_KEY are set.
 * Run explicitly: pnpm vitest run scripts/tanmemory-smoke.test.ts
 *
 * Exists outside the default tests/ include path so a normal `pnpm test`
 * doesn't bill API calls.
 */

import { describe, expect, it } from 'vitest'

import { tanmemoryEngine } from '#/server/memory/tanmemory'
import { makeTanmemoryTools } from '#/server/memory/tanmemory-tools'
import { getSessionDb } from '#/server/db/sessionDb'
import { tanmemoryMemories } from '#/server/db/schema'

const hasKeys = Boolean(process.env.OPENAI_API_KEY && process.env.ANTHROPIC_API_KEY)
const desc = hasKeys ? describe : describe.skip

desc('TanMemory smoke (live)', () => {
  const sessionId = `smoke-${Date.now()}`
  const scope = { sessionId }

  it('runs T1/T2/T3 and consolidates duplicates', async () => {
    const turns = [
      {
        user: 'My favorite framework is TanStack Start.',
        assistant: 'Got it — TanStack Start is a great choice.',
      },
      {
        user: 'I also really like Effect-TS.',
        assistant: 'Effect-TS for the structured-concurrency win.',
      },
      {
        user: 'I love TanStack Start the most.',
        assistant: 'Noted — TanStack Start is the favorite.',
      },
    ]
    for (const t of turns) {
      const receipts = await tanmemoryEngine.retainTurn(scope, t)
      expect(receipts.length).toBeGreaterThan(0)
      expect(receipts[0].engine).toBe('tanmemory')
      // eslint-disable-next-line no-console
      console.log('  retain:', JSON.stringify(receipts[0].raw))
    }

    const facts = await tanmemoryEngine.listFacts(scope)
    // eslint-disable-next-line no-console
    console.log('active facts:', facts.facts.map((f) => `${f.id} ${f.text}`))
    expect(facts.facts.length).toBeGreaterThan(0)

    const db = getSessionDb(sessionId)
    const all = db.select().from(tanmemoryMemories).all()
    const superseded = all.filter((r) => r.supersededBy !== null)
    // eslint-disable-next-line no-console
    console.log(
      'superseded:',
      superseded.map((r) => `${r.id}->${r.supersededBy}: ${r.content}`),
    )
  }, 120000)

  it('recall returns a populated systemPrompt and the three tools', async () => {
    const result = await tanmemoryEngine.recall(scope, 'what does the user like?')
    expect(result.engine).toBe('tanmemory')
    expect(typeof result.systemPrompt).toBe('string')
    expect(result.systemPrompt.length).toBeGreaterThan(0)
    expect(result.tools.map((t) => t.name).sort()).toEqual([
      'tanmemory_recall',
      'tanmemory_reflect',
      'tanmemory_retain',
    ])
    expect(result.toolGuidance.length).toBeGreaterThan(0)
    // eslint-disable-next-line no-console
    console.log('systemPrompt:\n' + result.systemPrompt)
  }, 60000)

  it('reflect synthesizes across stored memories', async () => {
    const tools = makeTanmemoryTools(scope)
    const reflectTool = tools.find((t) => t.name === 'tanmemory_reflect')
    expect(reflectTool?.execute).toBeDefined()
    const out = await reflectTool!.execute!({
      query: "what do I know about the user's stack?",
    })
    // eslint-disable-next-line no-console
    console.log('reflect:', out)
    expect(typeof out).toBe('string')
    expect((out as string).length).toBeGreaterThan(20)
  }, 60000)
})
