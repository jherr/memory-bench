import type { Fact, Renderer } from '@tanstack/ai-memory'

export interface BulletRendererConfig {
  /** Header line prepended when there is at least one fact. Defaults to "Recalled memory:". */
  header?: string
  /**
   * Optional engine prefix applied to ids so renderings look like
   * `- (local#abc) text`. Mirrors the original TanMemory `tanmemory#${id}`.
   * Pass an empty string (or omit) to render just `- (abc) text`.
   */
  idPrefix?: string
}

/**
 * Bullet-list renderer:
 *   Recalled memory:
 *   - (id) text
 *   - (id) text
 *
 * Returns an empty string when there are no facts.
 */
export function createBulletRenderer(config?: BulletRendererConfig): Renderer {
  const header = config?.header ?? 'Recalled memory:'
  const prefix = config?.idPrefix ?? ''
  return {
    render(facts: Array<Fact>): string {
      if (facts.length === 0) return ''
      const lines = facts.map(
        (f) => `- (${prefix ? `${prefix}#${f.id}` : f.id}) ${f.text}`,
      )
      return `${header}\n${lines.join('\n')}`
    },
  }
}
