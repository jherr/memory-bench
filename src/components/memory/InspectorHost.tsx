import { HindsightPanel } from './HindsightPanel'
import { HonchoPanel } from './HonchoPanel'
import { Mem0Panel } from './Mem0Panel'
import type { EngineId, MemorySnapshot } from '#/lib/memory/types'

export function InspectorHost({
  engineId,
  sessionId,
  turnId,
  data,
}: {
  engineId: EngineId
  sessionId: string
  turnId: number
  data?: MemorySnapshot['data']
}) {
  switch (engineId) {
    case 'hindsight':
      return <HindsightPanel sessionId={sessionId} turnId={turnId} data={data} />
    case 'mem0':
      return <Mem0Panel sessionId={sessionId} turnId={turnId} data={data} />
    case 'honcho':
      return <HonchoPanel sessionId={sessionId} turnId={turnId} data={data} />
  }
}
