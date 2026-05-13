import { hindsightEngine } from './hindsight'
import { honchoEngine } from './honcho'
import { mem0Engine } from './mem0'
import type { EngineId, MemoryEngine } from '#/lib/memory/types'

const REGISTRY: Partial<Record<EngineId, MemoryEngine>> = {
  hindsight: hindsightEngine,
  mem0: mem0Engine,
  honcho: honchoEngine,
}

export function getEngine(id: EngineId): MemoryEngine {
  const engine = REGISTRY[id]
  if (!engine) {
    throw new Error(`Engine "${id}" is not wired up yet`)
  }
  return engine
}

export function listEnabledEngines(): Array<MemoryEngine> {
  return Object.values(REGISTRY).filter((e): e is MemoryEngine => Boolean(e))
}

export function isEngineEnabled(id: EngineId): boolean {
  return Boolean(REGISTRY[id])
}
