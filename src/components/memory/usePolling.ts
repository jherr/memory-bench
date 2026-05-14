import { useEffect, useRef } from 'react'

/**
 * When `enabled`, runs `onTick('sync')` once, then `onTick('repeat')` every `intervalMs`.
 * Keeps the interval id in a ref so React StrictMode cleanup clears the timer that is
 * actually scheduled (avoids stale `setInterval` handles).
 *
 * `deps` should list every value `onTick` closes over that should restart the loop
 * (for example `sessionId`, `engineId`). Do not include fast-changing props that only
 * need the next tick — read those via refs inside `onTick` instead.
 */
export function useIntervalPolling(
  enabled: boolean,
  intervalMs: number,
  deps: readonly unknown[],
  onTick: (pass: 'sync' | 'repeat') => void | Promise<void>,
): void {
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    void onTickRef.current('sync')
    intervalRef.current = setInterval(() => void onTickRef.current('repeat'), intervalMs)
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies `deps`
  }, [enabled, intervalMs, ...deps])
}
