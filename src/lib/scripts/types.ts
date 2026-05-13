import { z } from 'zod'

export const ScriptTurnSchema = z.object({
  user: z.string().min(1),
})

export const ScriptSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  mode: z.enum(['explorer', 'scientist']).default('scientist'),
  activeEngine: z.enum(['hindsight', 'mem0', 'honcho']).default('hindsight'),
  turns: z.array(ScriptTurnSchema).min(1),
  options: z
    .object({
      interTurnDelayMs: z.number().int().nonnegative().default(800),
      waitForSnapshot: z.boolean().default(true),
    })
    .default({ interTurnDelayMs: 800, waitForSnapshot: true }),
})

export type Script = z.infer<typeof ScriptSchema>
export type ScriptTurn = z.infer<typeof ScriptTurnSchema>
