/** Pure v2 ledger normalization/projection. No IO. */
import { migrateV1Row, type LegacyMergeRow } from './migrate-v1.ts'
import type { MergeRowV2 } from './row.ts'
import { queueOf, type MergeQueue } from './state.ts'

export interface LedgerV2 {
  readonly schemaVersion: 2
  readonly rows: readonly MergeRowV2[]
}

export interface LedgerParseResult {
  readonly ok: boolean
  readonly ledger: LedgerV2
  readonly note?: string
}

function isRow(value: unknown): value is MergeRowV2 {
  const row = value as Partial<MergeRowV2>
  return typeof row.id === 'string' && typeof row.pairKey === 'string' && typeof row.a === 'string' && typeof row.b === 'string'
    && typeof row.state === 'string' && typeof row.createdAt === 'string' && typeof row.updatedAt === 'string'
}

export function parseLedger(raw: string | null): LedgerParseResult {
  if (raw === null) return { ok: true, ledger: { schemaVersion: 2, rows: [] } }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { ok: false, ledger: { schemaVersion: 2, rows: [] }, note: 'invalid json' } }
  const body = parsed as { schemaVersion?: unknown; rows?: unknown }
  if (!Array.isArray(body.rows)) return { ok: false, ledger: { schemaVersion: 2, rows: [] }, note: 'rows missing' }
  const rows: MergeRowV2[] = []
  let skipped = 0
  for (const value of body.rows) {
    if (body.schemaVersion === 1) {
      const legacy = value as LegacyMergeRow
      if (typeof legacy.id !== 'string' || typeof legacy.pairKey !== 'string' || typeof legacy.a !== 'string' || typeof legacy.b !== 'string' || typeof legacy.state !== 'string' || typeof legacy.createdAt !== 'string' || typeof legacy.updatedAt !== 'string') { skipped += 1; continue }
      const row = migrateV1Row(legacy)
      rows.push(row as MergeRowV2)
      continue
    }
    if (!isRow(value)) { skipped += 1; continue }
    rows.push(value)
  }
  const note = skipped === 0 ? undefined : String(skipped) + ' invalid row(s) skipped'
  return { ok: true, ledger: { schemaVersion: 2, rows }, ...(note === undefined ? {} : { note }) }
}

export function upsert(rows: readonly MergeRowV2[], row: MergeRowV2): readonly MergeRowV2[] {
  const index = rows.findIndex(current => current.pairKey === row.pairKey)
  if (index < 0) return [...rows, row]
  return rows.map((current, at) => at === index ? row : current)
}

export function remove(rows: readonly MergeRowV2[], pairKey: string): readonly MergeRowV2[] {
  return rows.filter(row => row.pairKey !== pairKey)
}

export function rowsOfQueue(rows: readonly MergeRowV2[], queue: MergeQueue): readonly MergeRowV2[] {
  return rows.filter(row => queueOf(row.state) === queue)
}

export function activeCounts(rows: readonly MergeRowV2[]): Record<MergeQueue, number> {
  const counts: Record<MergeQueue, number> = { verify: 0, pending: 0, fuse: 0, skipped: 0 }
  for (const row of rows) {
    if (row.expired !== undefined) continue
    counts[queueOf(row.state)] += 1
  }
  return counts
}
