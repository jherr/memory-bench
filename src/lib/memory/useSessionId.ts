import { useEffect, useState } from 'react'

const KEY = 'mb:sessionId'

export function useSessionId(): string | null {
  const [id, setId] = useState<string | null>(null)

  useEffect(() => {
    let stored = localStorage.getItem(KEY)
    if (!stored) {
      stored = crypto.randomUUID()
      localStorage.setItem(KEY, stored)
    }
    setId(stored)
  }, [])

  return id
}

export function resetSessionId(): string {
  const next = crypto.randomUUID()
  localStorage.setItem(KEY, next)
  return next
}
