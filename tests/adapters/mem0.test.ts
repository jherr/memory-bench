import { afterEach, describe, expect, it, vi } from 'vitest'

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

describe('mem0 adapter (mocked HTTP)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POST /search sends rerank, threshold, user_id and omits run_id', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    await mem0Engine.recall({ sessionId: 's1' }, 'favorite color')
    const searchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/search'))
    expect(searchCall).toBeDefined()
    const init = searchCall![1] as RequestInit
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      query: 'favorite color',
      user_id: 'demo-user',
      rerank: true,
      threshold: 0.1,
    })
    expect('run_id' in body).toBe(false)
  })

  it('POST /memories sends messages + user_id only', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    await mem0Engine.retainTurn(
      { sessionId: 's1' },
      { user: 'hi', assistant: 'hello' },
    )
    const memCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes('/memories') && (c[1] as RequestInit)?.method === 'POST',
    )
    expect(memCall).toBeDefined()
    const body = JSON.parse((memCall![1] as RequestInit).body as string)
    expect(body).toEqual({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      user_id: 'demo-user',
    })
    expect('run_id' in body).toBe(false)
  })
})

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
