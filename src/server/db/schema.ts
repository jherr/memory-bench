import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const sessionMeta = sqliteTable('session_meta', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mode: text('mode', { enum: ['explorer', 'scientist'] }).notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  modelChat: text('model_chat').notNull(),
  modelExtraction: text('model_extraction').notNull(),
  activeEngineLocked: text('active_engine_locked'),
})

export const turns = sqliteTable('turns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: text('ts')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  userContent: text('user_content').notNull(),
  assistantContent: text('assistant_content').notNull(),
  activeEngine: text('active_engine').notNull(),
})

export const retains = sqliteTable(
  'retains',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    turnId: integer('turn_id')
      .notNull()
      .references(() => turns.id),
    engine: text('engine').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    latencyMs: integer('latency_ms').notNull(),
    rawJson: text('raw_json').notNull(),
    error: text('error'),
    source: text('source', { enum: ['middleware', 'tool'] }),
  },
  (t) => [index('retains_engine_idx').on(t.engine)],
)

export const recalls = sqliteTable(
  'recalls',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    turnId: integer('turn_id')
      .notNull()
      .references(() => turns.id),
    engine: text('engine').notNull(),
    query: text('query').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    fragmentsJson: text('fragments_json').notNull(),
    rawJson: text('raw_json').notNull(),
    source: text('source', { enum: ['middleware', 'tool'] }),
  },
  (t) => [index('recalls_engine_idx').on(t.engine)],
)

export const snapshots = sqliteTable(
  'snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    turnId: integer('turn_id')
      .notNull()
      .references(() => turns.id),
    engine: text('engine').notNull(),
    kind: text('kind', { enum: ['pre', 'post'] })
      .notNull()
      .default('post'),
    takenAt: text('taken_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    dataJson: text('data_json').notNull(),
  },
  (t) => [index('snapshots_engine_idx').on(t.engine)],
)

export const tanmemoryMemories = sqliteTable(
  'tanmemory_memories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    content: text('content').notNull(),
    source: text('source', { enum: ['middleware', 'tool', 'consolidation'] }).notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    supersededBy: integer('superseded_by'),
  },
  (t) => [index('tanmemory_memories_active_idx').on(t.supersededBy)],
)
