import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import type {
  CandidateFact,
  ExtractContext,
  Extractor,
} from '@tanstack/ai-memory'

const DEFAULT_MODEL = 'claude-haiku-4-5'

const EXTRACT_SYSTEM = `You extract atomic, self-contained facts from a chat turn that would be worth remembering across future sessions. Output only facts that are durable and useful: preferences, identities, decisions, projects, relationships, specific knowledge. Skip pleasantries, small talk, and ephemeral context. Each fact must stand alone without conversation context.`

const ExtractionSchema = z.object({
  facts: z.array(z.string()),
})

export interface AnthropicExtractorConfig {
  apiKey: string
  model?: string
}

/**
 * Anthropic-backed extractor. Port of the existing TanMemory extractor:
 *   - same system prompt
 *   - same model default (claude-haiku-4-5)
 *   - same JSON output contract: { "facts": ["...", ...] }
 *
 * The `text` argument is expected to encode the turn (typically
 * `User: ...\nAssistant: ...`); the composed driver constructs it that way.
 */
export function createAnthropicExtractor(
  config: AnthropicExtractorConfig,
): Extractor {
  const model = config.model ?? DEFAULT_MODEL
  const client = new Anthropic({ apiKey: config.apiKey })

  return {
    async extract(
      text: string,
      _ctx?: ExtractContext,
    ): Promise<Array<CandidateFact>> {
      const res = await client.messages.create({
        model,
        max_tokens: 1024,
        system: EXTRACT_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `${text}\n\nReturn JSON in the shape: {"facts": ["fact 1", "fact 2", ...]}. If there's nothing worth remembering, return {"facts": []}. Output ONLY the JSON, no prose.`,
          },
        ],
      })
      const raw = textOf(res)
      const json = extractJsonBlock(raw)
      if (!json) return []
      try {
        const parsed = ExtractionSchema.parse(JSON.parse(json))
        return parsed.facts
          .map((f) => f.trim())
          .filter((f) => f.length > 0)
          .map((fact) => ({ text: fact }))
      } catch {
        return []
      }
    },
  }
}

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

function extractJsonBlock(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return trimmed
  const match = trimmed.match(/\{[\s\S]*\}/)
  return match ? match[0] : null
}
