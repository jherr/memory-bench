import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

import * as schema from './schema'

const migrationFiles = import.meta.glob('./migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const MIGRATION_NAMES = Object.keys(migrationFiles)
  .sort()
  .map((p) => ({ name: path.basename(p), sql: migrationFiles[p] }))

const SESSIONS_DIR = path.resolve(process.cwd(), 'data', 'sessions')
const CACHE_CAP = 16

type Entry = {
  db: Database.Database
  drz: BetterSQLite3Database<typeof schema>
  lastUsed: number
}

const cache = new Map<string, Entry>()

function ensureSessionsDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
}

function applyMigrations(db: Database.Database) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS __migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT DEFAULT CURRENT_TIMESTAMP
     )`,
  )
  const applied = new Set(
    (db.prepare('SELECT name FROM __migrations').all() as Array<{
      name: string
    }>).map((r) => r.name),
  )
  const insert = db.prepare('INSERT INTO __migrations (name) VALUES (?)')
  for (const { name, sql } of MIGRATION_NAMES) {
    if (applied.has(name)) continue
    const tx = db.transaction(() => {
      db.exec(sql)
      insert.run(name)
    })
    tx()
  }
}

function evictIfNeeded() {
  if (cache.size <= CACHE_CAP) return
  let oldestKey: string | null = null
  let oldestTime = Infinity
  for (const [k, v] of cache) {
    if (v.lastUsed < oldestTime) {
      oldestTime = v.lastUsed
      oldestKey = k
    }
  }
  if (oldestKey) {
    const e = cache.get(oldestKey)
    e?.db.close()
    cache.delete(oldestKey)
  }
}

export function getSessionDb(
  sessionId: string,
): BetterSQLite3Database<typeof schema> {
  const cached = cache.get(sessionId)
  if (cached) {
    cached.lastUsed = Date.now()
    return cached.drz
  }
  ensureSessionsDir()
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.sqlite`)
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  const drz = drizzle(db, { schema })
  cache.set(sessionId, { db, drz, lastUsed: Date.now() })
  evictIfNeeded()
  return drz
}

export function getSessionFilePath(sessionId: string): string {
  return path.join(SESSIONS_DIR, `${sessionId}.sqlite`)
}

export function closeAllSessions() {
  for (const [, e] of cache) e.db.close()
  cache.clear()
}
