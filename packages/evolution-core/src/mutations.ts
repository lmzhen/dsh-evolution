/**
 * Curator/author audit trail: `.mutations.json` records every skill mutation
 * with before/after content hashes so any automated edit is reviewable and
 * replayable. Best-effort persistence, mirroring the usage sidecar posture.
 * @module @deepseek-ai/dsh-evolution-core
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { nodeEvolutionIo, type EvolutionIoLike } from './io.ts'

export interface MutationRecord {
  skillName: string
  action: string
  beforeHash?: string
  afterHash?: string
  summary: string
  at: string
}

export const DEFAULT_MUTATION_CAP = 500
/** Version of the `.mutations.json` file shape; writers always emit the current one. */
export const MUTATIONS_FILE_VERSION = 1

export function mutationsFile(root: string): string {
  return join(root, '.mutations.json')
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function loadMutations(root: string, io: EvolutionIoLike = nodeEvolutionIo()): Promise<MutationRecord[]> {
  const raw = await io.readText(mutationsFile(root))
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    // Versioned shape ({ version, records }) with legacy plain-array compat.
    const records = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { records?: unknown }).records)
        ? (parsed as { records: unknown[] }).records
        : []
    return records.filter((entry): entry is MutationRecord =>
      typeof entry === 'object' && entry !== null && typeof (entry as MutationRecord).skillName === 'string'
      && typeof (entry as MutationRecord).action === 'string')
  } catch {
    // Malformed audit is treated as empty; auditing is best-effort.
    return []
  }
}

/** Append one record, trim to `cap`, and write atomically (versioned shape). */
export async function recordMutation(
  root: string,
  io: EvolutionIoLike,
  record: MutationRecord,
  cap = DEFAULT_MUTATION_CAP,
): Promise<void> {
  const existing = await loadMutations(root, io)
  existing.push(record)
  const trimmed = existing.length > cap ? existing.slice(existing.length - cap) : existing
  await io.writeText(mutationsFile(root), JSON.stringify({ version: MUTATIONS_FILE_VERSION, records: trimmed }, null, 2))
}
