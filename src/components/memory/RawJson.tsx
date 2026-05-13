import { useState } from 'react'

export function RawJson({ data }: { data: unknown }) {
  const [collapsed, setCollapsed] = useState(false)
  const json = JSON.stringify(data, null, 2)
  return (
    <div className="rounded border border-orange-500/20 bg-gray-900/60 text-xs">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-3 py-2 text-left text-gray-300 hover:text-orange-400 font-mono"
      >
        {collapsed ? '▶' : '▼'} raw ({json.length.toLocaleString()} chars)
      </button>
      {!collapsed && (
        <pre className="px-3 pb-3 overflow-auto max-h-[60vh] text-gray-200 font-mono text-[11px] leading-tight whitespace-pre-wrap">
          {json}
        </pre>
      )}
    </div>
  )
}
