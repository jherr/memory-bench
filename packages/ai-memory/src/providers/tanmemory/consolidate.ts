import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

const MODEL = process.env.MODEL_EXTRACTION ?? 'claude-haiku-4-5'

let _client: Anthropic | null = null
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}

const EXTRACT_SYSTEM = `You extract atomic, self-contained facts from a chat turn that would be worth remembering across future sessions. Output only facts that are durable and useful: preferences, identities, decisions, projects, relationships, specific knowledge. Skip pleasantries, small talk, and ephemeral context. Each fact must stand alone without conversation context.`

const ExtractionSchema = z.object({
  facts: z.array(z.string()),
})

export async function extractFacts(turn: {
  user: string
  assistant: string
}): Promise<Array<string>> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: EXTRACT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `User: ${turn.user}\nAssistant: ${turn.assistant}\n\nReturn JSON in the shape: {"facts": ["fact 1", "fact 2", ...]}. If there's nothing worth remembering, return {"facts": []}. Output ONLY the JSON, no prose.`,
      },
    ],
  })
  const text = textOf(res)
  return safeParseFacts(text)
}

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

function safeParseFacts(text: string): Array<string> {
  const json = extractJsonBlock(text)
  if (!json) return []
  try {
    const parsed = ExtractionSchema.parse(JSON.parse(json))
    return parsed.facts.map((f) => f.trim()).filter((f) => f.length > 0)
  } catch {
    return []
  }
}

export interface Neighbor {
  id: number
  content: string
  similarity: number
}

export type ConsolidationDecision =
  | { action: 'insert' }
  | { action: 'merge'; intoId: number; newText: string }
  | { action: 'skip'; reason?: string }

const ConsolidationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('insert') }),
  z.object({
    action: z.literal('merge'),
    intoId: z.number().int(),
    newText: z.string().min(1),
  }),
  z.object({ action: z.literal('skip'), reason: z.string().optional() }),
])

const CONSOLIDATE_SYSTEM = `You decide how to incorporate a new fact into existing memory. For each new fact you'll see up to 5 similar existing memories with their numeric ids. Decide exactly one of:

- "insert": the new fact is genuinely new information not covered by the existing memories.
- "merge": the new fact updates, refines, or restates one of the existing memories. Pick the most relevant existing id and write a single combined fact that preserves both old and new information. The merged text should be a single concise sentence.
- "skip": the new fact is already fully covered by an existing memory (a near-duplicate). Optionally provide a brief reason.

Be conservative: prefer "merge" when there's clear overlap, prefer "insert" when in doubt. Only "skip" when the new fact adds nothing.`

export async function decideConsolidation(
  newFact: string,
  neighbors: Array<Neighbor>,
): Promise<ConsolidationDecision> {
  if (neighbors.length === 0) return { action: 'insert' }

  const neighborList = neighbors
    .map((n) => `  id=${n.id} (sim=${n.similarity.toFixed(2)}): ${n.content}`)
    .join('\n')

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 512,
    system: CONSOLIDATE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `New fact:\n  ${newFact}\n\nExisting memories:\n${neighborList}\n\nReturn JSON in one of these exact shapes:\n  {"action": "insert"}\n  {"action": "merge", "intoId": <id>, "newText": "<merged sentence>"}\n  {"action": "skip", "reason": "<optional>"}\n\nOutput ONLY the JSON, no prose.`,
      },
    ],
  })
  const text = textOf(res)
  const json = extractJsonBlock(text)
  if (!json) return { action: 'insert' }
  try {
    return ConsolidationSchema.parse(JSON.parse(json))
  } catch {
    return { action: 'insert' }
  }
}

function extractJsonBlock(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return trimmed
  const match = trimmed.match(/\{[\s\S]*\}/)
  return match ? match[0] : null
}
