import { hindsightEngine } from '@tanstack/ai-memory/hindsight'
import { honchoEngine } from '@tanstack/ai-memory/honcho'
import { mem0Engine } from '@tanstack/ai-memory/mem0'
import { tanmemoryEngine } from '@tanstack/ai-memory/tanmemory'
import type { EngineId, MemoryDriver } from '@tanstack/ai-memory'

const REGISTRY: Partial<Record<EngineId, MemoryDriver>> = {}

export function registerEngine(engine: MemoryDriver): void {
  REGISTRY[engine.id] = engine
}

registerEngine(hindsightEngine)
registerEngine(mem0Engine)
registerEngine(honchoEngine)
registerEngine(tanmemoryEngine)

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
