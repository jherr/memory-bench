import { describe, expect, it } from 'vitest'

import { hindsightEngine } from '@tanstack/ai-memory/hindsight'

const HINDSIGHT_URL = process.env.HINDSIGHT_URL ?? 'http://localhost:8888'

async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${HINDSIGHT_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

const reachable = await isReachable()
const desc = reachable ? describe : describe.skip

desc('hindsight adapter (live)', () => {
  const sessionId = `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const scope = { sessionId }

  it('retains a user/assistant turn without throwing', async () => {
    const receipts = await hindsightEngine.retainTurn(scope, {
      user: 'My favorite color is teal.',
      assistant: 'Got it — teal is a great choice.',
    })
    expect(receipts).toHaveLength(2)
    expect(receipts.every((r) => r.engine === 'hindsight')).toBe(true)
    expect(receipts.every((r) => typeof r.latencyMs === 'number')).toBe(true)
    expect(receipts.some((r) => r.ok)).toBe(true)
  })

  it('recalls a fragment after retain', async () => {
    const result = await hindsightEngine.recall(scope, 'favorite color')
    expect(result.engine).toBe('hindsight')
    expect(Array.isArray(result.fragments)).toBe(true)
  })

  it('inspect returns a snapshot with memories and profile keys', async () => {
    const snap = await hindsightEngine.inspect(scope)
    expect(snap.engine).toBe('hindsight')
    expect(typeof snap.takenAt).toBe('string')
    expect(snap.data).toHaveProperty('memories')
    expect(snap.data).toHaveProperty('profile')
  })
})

if (!reachable) {
  describe('hindsight adapter (live) — skipped', () => {
    it('is skipped because HINDSIGHT_URL is not reachable', () => {
      expect(true).toBe(true)
    })
  })
}
