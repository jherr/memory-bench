import { ENGINE_IDS, type EngineId } from '@tanstack/ai-memory'

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_SCRIPT_ID_RE = /^[a-zA-Z0-9._-]{1,80}$/
const SAFE_RUN_ID_RE = /^[a-zA-Z0-9._-]{1,120}$/

export function isValidSessionId(sessionId: string): boolean {
  return UUID_V4_RE.test(sessionId)
}

export function assertSessionId(sessionId: string): string {
  if (!isValidSessionId(sessionId)) {
    throw new Error('Invalid session id')
  }
  return sessionId
}

export function isValidEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && ENGINE_IDS.includes(value as EngineId)
}

export function isValidScriptId(scriptId: string): boolean {
  return SAFE_SCRIPT_ID_RE.test(scriptId)
}

export function assertScriptId(scriptId: string): string {
  if (!isValidScriptId(scriptId)) {
    throw new Error('Invalid script id')
  }
  return scriptId
}

export function isValidRunId(runId: string): boolean {
  return SAFE_RUN_ID_RE.test(runId)
}

export function assertRunId(runId: string): string {
  if (!isValidRunId(runId)) {
    throw new Error('Invalid run id')
  }
  return runId
}
