/**
 * Skill usage telemetry sidecar: `$DSH_HOME/skills/.usage.json`.
 * Format-compatible with Hermes Agent / hermes-claw core fields.
 */

import { join } from 'node:path'
import { nodeEvolutionIo, type EvolutionIoLike } from './io.ts'

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

export async function loadUsage(root: string, io: EvolutionIoLike = nodeEvolutionIo()): Promise<UsageMap> {
  const map: UsageMap = new Map()
  const raw = await io.readText(usageFile(root))
  if (raw !== null) {
    try {
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
      // Malformed sidecar is treated as empty. Telemetry is best-effort.
    }
  }
  return map
}

export async function saveUsage(root: string, map: UsageMap, io: EvolutionIoLike = nodeEvolutionIo()): Promise<void> {
  const obj = Object.fromEntries(map.entries())
  await io.writeText(usageFile(root), JSON.stringify(obj, null, 2))
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

/**
 * Curator suppression sidecar: built-in skills the curator has archived stay
 * suppressed across re-seeds, so the lifecycle never fights a re-created
 * bundled skill. Best-effort load/save, mirroring the usage sidecar posture.
 * Versioned shape ({ version, names }) with legacy plain-array compat.
 */
export const SUPPRESSED_FILE_VERSION = 1

export function suppressedFile(root: string): string {
  return join(root, '.curator-suppressed.json')
}

export async function loadSuppressedNames(root: string, io: EvolutionIoLike = nodeEvolutionIo()): Promise<ReadonlySet<string>> {
  const raw = await io.readText(suppressedFile(root))
  if (raw === null) return new Set()
  try {
    const parsed = JSON.parse(raw) as unknown
    const names = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { names?: unknown }).names)
        ? (parsed as { names: unknown[] }).names
        : []
    return new Set(names.filter((entry): entry is string => typeof entry === 'string'))
  } catch {
    // Malformed sidecar is treated as empty. Suppression is best-effort.
    return new Set()
  }
}

export async function saveSuppressedNames(
  root: string,
  names: ReadonlySet<string>,
  io: EvolutionIoLike = nodeEvolutionIo(),
): Promise<void> {
  await io.writeText(suppressedFile(root), JSON.stringify({ version: SUPPRESSED_FILE_VERSION, names: [...names].sort() }, null, 2))
}
