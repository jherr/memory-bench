type Phase = 'pre' | 'post'

export function ConsolidationToggle({
  phase,
  onChange,
}: {
  phase: Phase
  onChange: (phase: Phase) => void
}) {
  return (
    <div className="flex gap-1 text-xs">
      {(['pre', 'post'] as const).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-2 py-1 rounded ${
            phase === p
              ? 'bg-gray-700 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
          title={
            p === 'pre'
              ? 'state immediately after retain'
              : 'state after consolidation delay'
          }
        >
          {p}-consolidation
        </button>
      ))}
    </div>
  )
}
