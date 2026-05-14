import { describe, expect, it } from 'vitest'

import {
  honchoEngine,
  parseHonchoRepresentationToFacts,
} from '#/server/memory/honcho'

const HONCHO_URL = process.env.HONCHO_URL ?? 'http://localhost:8001'

async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${HONCHO_URL}/`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok || res.status === 401 || res.status === 404
  } catch {
    return false
  }
}

const reachable = await isReachable()
const desc = reachable ? describe : describe.skip

describe('parseHonchoRepresentationToFacts', () => {
  it('parses timestamped observation lines', () => {
    const raw = `[2025-01-01T12:00:00] User prefers teal for accents`
    const facts = parseHonchoRepresentationToFacts(raw)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.text).toBe('User prefers teal for accents')
    expect(facts[0]!.source).toBe('observation')
    expect(facts[0]!.createdAt).toBe('2025-01-01T12:00:00')
  })

  it('skips section headers and keeps non-timestamp lines', () => {
    const raw = `## Notes\nExplicit Observations\n[ts] fact one\nfreeform bullet`
    const facts = parseHonchoRepresentationToFacts(raw)
    expect(facts.map((f) => f.text)).toEqual(['fact one', 'freeform bullet'])
  })
})

desc('honcho adapter (live)', () => {
  const sessionId = `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const scope = { sessionId }

  it('retains a turn without throwing', async () => {
    const receipts = await honchoEngine.retainTurn(scope, {
      user: 'My favorite color is teal.',
      assistant: 'Got it — teal is a great choice.',
    })
    expect(receipts.length).toBeGreaterThan(0)
    expect(receipts.every((r) => r.engine === 'honcho')).toBe(true)
  })

  it('recall returns a structured result', async () => {
    const result = await honchoEngine.recall(scope, 'favorite color')
    expect(result.engine).toBe('honcho')
    expect(typeof result.systemPrompt).toBe('string')
    expect(result.fragments).toBeUndefined()
    expect(result.tools).toEqual([])
    expect(result.toolGuidance).toBe('')
  })

  it('inspect returns a snapshot with messages key', async () => {
    const snap = await honchoEngine.inspect(scope)
    expect(snap.engine).toBe('honcho')
    expect(typeof snap.takenAt).toBe('string')
    expect(snap.data).toHaveProperty('messages')
  })
})

if (!reachable) {
  describe('honcho adapter (live) — skipped', () => {
    it('is skipped because HONCHO_URL is not reachable', () => {
      expect(true).toBe(true)
    })
  })
}
