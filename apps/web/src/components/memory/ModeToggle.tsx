import { resetSessionId } from '#/lib/memory/useSessionId'

type Mode = 'explorer' | 'scientist'

export function ModeToggle({
  mode,
  onChange,
  hasTurns,
}: {
  mode: Mode
  onChange: (mode: Mode) => void
  hasTurns: boolean
}) {
  const handleClick = (next: Mode) => {
    if (next === mode) return
    if (hasTurns) {
      const ok = window.confirm(
        `Changing mode mid-session is not allowed. Start a new session?`,
      )
      if (!ok) return
      resetSessionId()
      window.location.reload()
      return
    }
    onChange(next)
  }
  return (
    <div className="flex gap-1 text-xs">
      {(['explorer', 'scientist'] as const).map((m) => (
        <button
          key={m}
          onClick={() => handleClick(m)}
          className={`px-2 py-1 rounded ${
            mode === m
              ? 'bg-gray-700 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
          title={
            m === 'explorer'
              ? 'switch engine mid-session'
              : 'engine locked at session start'
          }
        >
          {m}
        </button>
      ))}
    </div>
  )
}
