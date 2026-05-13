import { describe, expect, it } from 'vitest'

import { mem0Engine } from '#/server/memory/mem0'

const MEM0_URL = process.env.MEM0_URL ?? 'http://localhost:8000'

async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${MEM0_URL}/configure`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok || res.status === 401
  } catch {
    return false
  }
}

const reachable = await isReachable()
const desc = reachable ? describe : describe.skip

desc('mem0 adapter (live)', () => {
  const sessionId = `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const scope = { sessionId }

  it('retains a turn without throwing', async () => {
    const receipts = await mem0Engine.retainTurn(scope, {
      user: 'My favorite color is teal.',
      assistant: 'Got it — teal is a great choice.',
    })
    expect(receipts.length).toBeGreaterThan(0)
    expect(receipts.every((r) => r.engine === 'mem0')).toBe(true)
  })

  it('recall returns a structured result', async () => {
    const result = await mem0Engine.recall(scope, 'favorite color')
    expect(result.engine).toBe('mem0')
    expect(Array.isArray(result.fragments)).toBe(true)
  })

  it('inspect returns a snapshot', async () => {
    const snap = await mem0Engine.inspect(scope)
    expect(snap.engine).toBe('mem0')
    expect(typeof snap.takenAt).toBe('string')
  })
})

if (!reachable) {
  describe('mem0 adapter (live) — skipped', () => {
    it('is skipped because MEM0_URL is not reachable', () => {
      expect(true).toBe(true)
    })
  })
}
