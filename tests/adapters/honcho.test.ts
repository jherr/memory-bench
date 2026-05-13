import { describe, expect, it } from 'vitest'

import { honchoEngine } from '#/server/memory/honcho'

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
    expect(Array.isArray(result.fragments)).toBe(true)
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
