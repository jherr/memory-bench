import { z } from 'zod'

const messageSchema = z
  .object({
    role: z.enum(['user', 'assistant', 'tool']),
    content: z.string().optional(),
    parts: z
      .array(
        z.object({
          type: z.string(),
          content: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough()

export const chatRequestSchema = z
  .object({
    messages: z.array(messageSchema).min(1),
    data: z
      .object({
        sessionId: z.string().optional(),
        engineId: z.string().optional(),
        memoryEnabled: z.boolean().optional(),
      })
      .optional(),
    sessionId: z.string().optional(),
    engineId: z.string().optional(),
    memoryEnabled: z.boolean().optional(),
  })
  .passthrough()
