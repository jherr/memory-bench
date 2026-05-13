import { ScriptSchema } from './types'
import type { Script } from './types'

const modules = import.meta.glob('../../../scripts/conversations/*.json', {
  eager: true,
}) as Record<string, { default: unknown }>

const scripts: Array<Script> = Object.entries(modules)
  .map(([path, mod]) => {
    const parsed = ScriptSchema.safeParse(mod.default)
    if (!parsed.success) {
      console.error(
        `[scripts] invalid script at ${path}:`,
        parsed.error.flatten(),
      )
      return null
    }
    return parsed.data
  })
  .filter((s): s is Script => s !== null)

export function listScripts(): Array<Script> {
  return scripts
}

export function getScriptById(id: string): Script | undefined {
  return scripts.find((s) => s.id === id)
}
