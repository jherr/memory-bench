import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import * as sqliteVec from 'sqlite-vec'

import * as schema from './schema'

const SESSIONS_DIR = path.resolve(
  process.env.TANMEMORY_SESSIONS_DIR ??
    path.join(process.cwd(), 'data', 'tanmemory-sessions'),
)
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

function applySchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS tanmemory_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    updated_at TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
    superseded_by INTEGER
  )`)
  db.exec(
    'CREATE INDEX IF NOT EXISTS tanmemory_memories_active_idx ON tanmemory_memories (superseded_by)',
  )
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS tanmemory_vec USING vec0(
    memory_id INTEGER PRIMARY KEY,
    embedding FLOAT[1536]
  )`)
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
    cache.get(oldestKey)?.db.close()
    cache.delete(oldestKey)
  }
}

function openSession(sessionId: string): Entry {
  const cached = cache.get(sessionId)
  if (cached) {
    cached.lastUsed = Date.now()
    return cached
  }
  ensureSessionsDir()
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.sqlite`)
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  sqliteVec.load(db)
  applySchema(db)
  const drz = drizzle(db, { schema })
  const entry: Entry = { db, drz, lastUsed: Date.now() }
  cache.set(sessionId, entry)
  evictIfNeeded()
  return entry
}

export function getSessionDb(
  sessionId: string,
): BetterSQLite3Database<typeof schema> {
  return openSession(sessionId).drz
}

export function getRawSessionDb(sessionId: string): Database.Database {
  return openSession(sessionId).db
}

export function getSessionsDir(): string {
  return SESSIONS_DIR
}

export function closeAllSessions() {
  for (const [, e] of cache) e.db.close()
  cache.clear()
}

export * from './schema'
