/**
 * Curator/author audit trail: `.mutations.json` records every skill mutation
 * with before/after content hashes so any automated edit is reviewable and
 * replayable. Best-effort persistence, mirroring the usage sidecar posture.
 * @module @deepseek-ai/dsh-evolution-core
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { nodeEvolutionIo, transactIo, type EvolutionIoLike } from './io.ts'

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

/**
 * Parse a raw mutations sidecar; malformed content reads as empty (auditing is
 * best-effort). Versioned shape ({ version, records }) with legacy
 * plain-array compat, plus a field-level guard for records without the
 * required identity/timestamp fields (rc.42 audit P2-3).
 */
function parseMutationRecords(raw: string | null): MutationRecord[] {
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    const records = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { records?: unknown }).records)
        ? (parsed as { records: unknown[] }).records
        : []
    return records.filter((entry): entry is MutationRecord =>
      typeof entry === 'object' && entry !== null && typeof (entry as MutationRecord).skillName === 'string'
      && typeof (entry as MutationRecord).action === 'string'
      && typeof (entry as MutationRecord).at === 'string')
  } catch {
    return []
  }
}

export async function loadMutations(root: string, io: EvolutionIoLike = nodeEvolutionIo()): Promise<MutationRecord[]> {
  return parseMutationRecords(await io.readText(mutationsFile(root)))
}

/** Append one record, trim to `cap`, and write atomically (versioned shape). */
export async function recordMutation(
  root: string,
  io: EvolutionIoLike,
  record: MutationRecord,
  cap = DEFAULT_MUTATION_CAP,
): Promise<void> {
  // The read-append-write runs as one atomic transact (rc.50 P2-2): a second
  // process sharing DSH_HOME can no longer interleave its append between our
  // read and write and lose an audit record.
  await transactIo(io, mutationsFile(root), async (current) => {
    // P3 (v3 audit): never overwrite a malformed audit file with a re-serialized empty.
    if (current !== null) {
      try { JSON.parse(current) } catch { return current }
    }
    const existing = parseMutationRecords(current)
    existing.push(record)
    const trimmed = existing.length > cap ? existing.slice(existing.length - cap) : existing
    return Promise.resolve(JSON.stringify({ version: MUTATIONS_FILE_VERSION, records: trimmed }, null, 2))
  })
}
