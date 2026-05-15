import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

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
