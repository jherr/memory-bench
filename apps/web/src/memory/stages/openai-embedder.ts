import OpenAI from 'openai'

import type { Embedder } from '@tanstack/ai-memory'

const DEFAULT_MODEL = 'text-embedding-3-small'

export interface OpenAIEmbedderConfig {
  apiKey: string
  model?: string
}

/**
 * OpenAI-backed embedder. Defaults to `text-embedding-3-small` (1536 dims).
 * `text-embedding-3-small` returns unit-norm vectors, so L2 and cosine
 * distance are monotonically related — useful for sqlite-vec's L2 KNN.
 */
export function createOpenAIEmbedder(config: OpenAIEmbedderConfig): Embedder {
  const model = config.model ?? DEFAULT_MODEL
  const client = new OpenAI({ apiKey: config.apiKey })

  return {
    async embed(texts: Array<string>): Promise<Array<Float32Array>> {
      if (texts.length === 0) return []
      const res = await client.embeddings.create({ model, input: texts })
      return res.data.map((d) => new Float32Array(d.embedding))
    },
  }
}

/** Float32Array -> Buffer suitable for sqlite-vec FLOAT[N] columns. */
export function toVecBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

/**
 * Convert sqlite-vec distance (lower=closer, L2) to a similarity in [0,1].
 * Not strictly cosine — sqlite-vec uses L2 by default — but produces a
 * usable threshold knob. With unit-norm vectors: similarity = 1 - distance² / 2.
 */
export function l2DistanceToSimilarity(distance: number): number {
  return Math.max(0, 1 - (distance * distance) / 2)
}

export const EMBEDDING_DIM = 1536
