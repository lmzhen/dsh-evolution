/** Pure pairKey index serialization. No IO. */
import type { PairIndexEntryV2 } from './indexes.ts'

export interface PairIndexFile {
  readonly schemaVersion: 1
  readonly entries: readonly PairIndexEntryV2[]
}

export function parsePairIndex(raw: string | null): Map<string, PairIndexEntryV2> {
  const index = new Map<string, PairIndexEntryV2>()
  if (raw === null) return index
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return index }
  const body = parsed as { entries?: unknown }
  if (!Array.isArray(body.entries)) return index
  for (const value of body.entries) {
    const entry = value as Partial<PairIndexEntryV2>
    if (typeof entry.pairKey !== 'string' || typeof entry.runId !== 'string' || typeof entry.result !== 'string') continue
    if (!['merged', 'kept', 'failed', 'cancelled', 'undone'].includes(entry.result)) continue
    index.set(entry.pairKey, entry as PairIndexEntryV2)
  }
  return index
}

export function serializePairIndex(index: ReadonlyMap<string, PairIndexEntryV2>): string {
  return JSON.stringify({ schemaVersion: 1, entries: [...index.values()] }, null, 2)
}
