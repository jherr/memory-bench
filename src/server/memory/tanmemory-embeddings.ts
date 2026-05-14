import OpenAI from 'openai'

const MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIM = 1536

let _client: OpenAI | null = null
function client(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _client
}

export async function embed(text: string): Promise<Float32Array> {
  const r = await client().embeddings.create({ model: MODEL, input: text })
  return new Float32Array(r.data[0].embedding)
}

export async function embedMany(texts: Array<string>): Promise<Array<Float32Array>> {
  if (texts.length === 0) return []
  const r = await client().embeddings.create({ model: MODEL, input: texts })
  return r.data.map((d) => new Float32Array(d.embedding))
}

/** Float32Array -> Buffer suitable for sqlite-vec FLOAT[N] columns. */
export function toVecBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

/** Convert sqlite-vec distance (lower=closer, L2) to a cosine-ish similarity ∈ [0,1].
 *  Not strictly cosine — sqlite-vec uses L2 by default — but produces a usable threshold
 *  knob. text-embedding-3-small returns unit-norm vectors so L2 and cosine are monotonically
 *  related: similarity = 1 - distance² / 2. */
export function l2DistanceToSimilarity(distance: number): number {
  return Math.max(0, 1 - (distance * distance) / 2)
}
