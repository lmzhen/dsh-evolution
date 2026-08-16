/**
 * Skill usage telemetry sidecar: `$DSH_HOME/skills/.usage.json`.
 * Format-compatible with Hermes Agent / hermes-claw core fields.
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export type SkillState = 'active' | 'stale' | 'archived'

export interface UsageRecord {
  created_by: string | null
  use_count: number
  view_count: number
  patch_count: number
  last_used_at: string | null
  last_viewed_at: string | null
  last_patched_at: string | null
  created_at: string
  state: SkillState
  pinned: boolean
  archived_at: string | null
  quality_score?: number
  quality_warn?: boolean
}

export type UsageMap = Map<string, UsageRecord>

export function usageFile(root: string): string {
  return join(root, '.usage.json')
}

export function emptyRecord(): UsageRecord {
  return {
    created_by: null,
    use_count: 0,
    view_count: 0,
    patch_count: 0,
    last_used_at: null,
    last_viewed_at: null,
    last_patched_at: null,
    created_at: new Date().toISOString(),
    state: 'active',
    pinned: false,
    archived_at: null,
  }
}

export async function loadUsage(root: string): Promise<UsageMap> {
  const map: UsageMap = new Map()
  try {
    const raw = await readFile(usageFile(root), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, Partial<UsageRecord>>
    for (const [name, record] of Object.entries(parsed)) {
      const base = emptyRecord()
      map.set(name, {
        ...base,
        ...record,
        state: record.state === 'stale' || record.state === 'archived' ? record.state : 'active',
      })
    }
  } catch {
    // Missing or malformed sidecar is treated as empty. Telemetry is best-effort.
  }
  return map
}

export async function saveUsage(root: string, map: UsageMap): Promise<void> {
  await mkdir(dirname(usageFile(root)), { recursive: true })
  const obj = Object.fromEntries(map.entries())
  const tmp = `${usageFile(root)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8')
  await rename(tmp, usageFile(root))
}

export function getRecord(map: UsageMap, name: string): UsageRecord {
  let record = map.get(name)
  if (!record) {
    record = emptyRecord()
    map.set(name, record)
  }
  return record
}

export function bumpView(map: UsageMap, name: string, when = new Date()): void {
  const record = getRecord(map, name)
  record.view_count += 1
  record.last_viewed_at = when.toISOString()
}

export function bumpUse(map: UsageMap, name: string, when = new Date()): void {
  const record = getRecord(map, name)
  record.use_count += 1
  record.last_used_at = when.toISOString()
}

export function bumpPatch(map: UsageMap, name: string, when = new Date()): void {
  const record = getRecord(map, name)
  record.patch_count += 1
  record.last_patched_at = when.toISOString()
}

export function markAgentCreated(map: UsageMap, name: string): void {
  getRecord(map, name).created_by = 'agent'
}

export function latestActivityAt(record: UsageRecord): string | null {
  const values = [record.last_used_at, record.last_viewed_at, record.last_patched_at]
    .filter((value): value is string => typeof value === 'string')
  if (values.length === 0) return null
  return values.sort().reverse()[0] ?? null
}
