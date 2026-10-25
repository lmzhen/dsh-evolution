/** Durable staging index for v3 pending/approved rows (rowId-keyed). */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

export interface StagingEntry {
  readonly rowId: string
  readonly pairKey: string
  readonly ref: string
  readonly expiresAt: number
  readonly runId?: string
  readonly createdAt: number
  readonly state?: 'reserved' | 'present' | 'expired' | 'lost'
}

export function stagingIndexPath(home: string, rowId: string): string {
  return join(home, 'merge', 'staging-index', encodeURIComponent(rowId) + '.json')
}

export async function readStagingIndex(io: EvolutionIoLike, home: string, rowId: string, now = Date.now()): Promise<StagingEntry | null> {
  let raw: string | null
  try { raw = await io.readText(stagingIndexPath(home, rowId)) } catch { return null }
  if (raw === null) return null
  try {
    const entry = JSON.parse(raw) as StagingEntry
    if (entry.rowId !== rowId || typeof entry.ref !== 'string' || typeof entry.expiresAt !== 'number') return null
    if (entry.expiresAt <= now) return null
    return entry
  } catch { return null }
}

export async function writeStagingIndex(io: EvolutionIoLike, home: string, entry: StagingEntry): Promise<void> {
  const text = JSON.stringify(entry, null, 2) + '\n'
  if (io.transact !== undefined) await io.transact(stagingIndexPath(home, entry.rowId), () => text)
  else await io.writeText(stagingIndexPath(home, entry.rowId), text)
}

export async function deleteStagingIndex(io: EvolutionIoLike, home: string, rowId: string): Promise<void> {
  try { await io.remove(stagingIndexPath(home, rowId)) } catch { /* missing/already removed */ }
}
