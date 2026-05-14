import { hindsightEngine } from './hindsight'
import { honchoEngine } from './honcho'
import { mem0Engine } from './mem0'
import type { EngineId, MemoryDriver } from '#/lib/memory/types'

const REGISTRY: Partial<Record<EngineId, MemoryDriver>> = {
  hindsight: hindsightEngine,
  mem0: mem0Engine,
  honcho: honchoEngine,
}

export function getEngine(id: EngineId): MemoryDriver {
  const engine = REGISTRY[id]
  if (!engine) {
    throw new Error(`Engine "${id}" is not wired up yet`)
  }
  return engine
}

export function listEnabledEngines(): Array<MemoryDriver> {
  return Object.values(REGISTRY).filter((e): e is MemoryDriver => Boolean(e))
}

export function isEngineEnabled(id: EngineId): boolean {
  return Boolean(REGISTRY[id])
}
