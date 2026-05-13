import type { EngineId } from '#/lib/memory/types'
import { ENGINE_IDS } from '#/lib/memory/types'

const COLORS: Record<EngineId, string> = {
  hindsight: 'from-orange-500/80 to-red-600/80',
  mem0: 'from-violet-500/80 to-fuchsia-600/80',
  honcho: 'from-emerald-500/80 to-teal-600/80',
}

export function EngineSelector({
  active,
  onChange,
  enabled,
  locked,
}: {
  active: EngineId
  onChange: (id: EngineId) => void
  enabled: Record<EngineId, boolean>
  locked?: boolean
}) {
  return (
    <div className="flex gap-1">
      {ENGINE_IDS.map((id) => {
        const isEnabled = enabled[id]
        const isActive = id === active
        return (
          <button
            key={id}
            disabled={!isEnabled || locked}
            onClick={() => onChange(id)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              isActive
                ? `bg-linear-to-r ${COLORS[id]} text-white`
                : 'bg-gray-800/50 text-gray-400 border border-orange-500/10 hover:text-orange-300'
            } ${!isEnabled ? 'opacity-40 cursor-not-allowed' : ''} ${
              locked && !isActive ? 'opacity-50' : ''
            }`}
            title={!isEnabled ? `${id} not wired up yet` : id}
          >
            {id}
          </button>
        )
      })}
    </div>
  )
}
