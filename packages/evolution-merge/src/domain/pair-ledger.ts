import { readTextOrNull } from './read-probe.ts'
/** 1b-1 additive read view; the production row writer stays in state.ts until 1b-2. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { readStateReadiness, mergeStatePath, StateBlockedError } from './state-bootstrap.ts'
import { transactIo } from '@deepseek-ai/dsh-evolution-core'
import { createPre1bBackup } from './pre-1b-backup.ts'
import { adoptLegacyProduction } from './stage-aggregate.ts'
import { normalizeV3State, parseV4State, readV4Readiness } from './schema4.ts'
import type { V4Row } from './row-v4.ts'
import { isV3Row, type V3Row } from './row-v3.ts'
import { transactMergeState, type V4RowTx } from './schema4.ts'

export type PairRow = V3Row
export interface PairLedgerRead {
  readonly schemaVersion: 3
  readonly ledgerVersion?: number
  readonly migration?: unknown
  readonly rows: readonly V3Row[]
}
export interface PairLedger {
  read(): Promise<PairLedgerRead>
  transact<T>(fn: (tx: V4RowTx) => T): Promise<T>
  normalize(): Promise<NormalizeResult>
}
export interface NormalizeResult {
  readonly ok: boolean
  readonly migrated: boolean
  readonly backupRef?: string
  readonly message?: string
}

/** Read-only 1b-1 bypass. It does not normalize, back up, or write state. */
export async function readPairLedger(io: EvolutionIoLike, home: string): Promise<PairLedgerRead> {
  const ready = await readStateReadiness(io, home)
  if (!ready.ok) throw new StateBlockedError(ready)
  let header: { ledgerVersion?: unknown; migration?: unknown } = {}
  try {
    const raw = await io.readText(join(home, 'merge', 'merge-state.json'))
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { ledgerVersion?: unknown; migration?: unknown }
      header = parsed
    }
  } catch { /* readiness already validated the state; header is optional */ }
  return {
    schemaVersion: 3,
    ...(typeof header.ledgerVersion === 'number' ? { ledgerVersion: header.ledgerVersion } : {}),
    ...(header.migration === undefined ? {} : { migration: header.migration }),
    rows: ready.state.rows,
  }
}

/** 1b-2a write skeleton. Production stays on the v3 gate until 1b-2b. */
export function pairLedger(io: EvolutionIoLike, home: string): PairLedger {
  return {
    read: () => readPairLedger(io, home),
    transact: async fn => {
      const current = await readV4Readiness(io, home)
      if (!current.ok) {
        const normalized = await normalizePairLedger(io, home)
        if (!normalized.ok) throw new Error(normalized.message ?? 'normalize failed')
      }
      return await transactMergeState(io, home, fn)
    },
    normalize: () => normalizePairLedger(io, home),
  }
}

/** v3-to-v4 normalize: backup -> production stage adopt -> v4 state. Not called in 1b-2a. */
export async function normalizePairLedger(io: EvolutionIoLike, home: string): Promise<NormalizeResult> {
  const v4 = await readV4Readiness(io, home)
  if (v4.ok) return { ok: true, migrated: false }
  if (v4.code !== 'merge-state-normalize-required' && v4.code !== 'merge-state-v4-required') return { ok: false, migrated: false, message: v4.code + ': ' + v4.message }
  let v3 = await readStateReadiness(io, home)
  if (!v3.ok) return { ok: false, migrated: false, message: v3.code + ': ' + v3.message }
  if (v4.code === 'merge-state-v4-required') {
    await transactIo(io, mergeStatePath(home), current => current === null ? JSON.stringify({ schemaVersion: 3, rows: [] }) + '\n' : current)
    v3 = await readStateReadiness(io, home)
    if (!v3.ok) return { ok: false, migrated: false, message: v3.code + ': ' + v3.message }
  }
  const backup = await createPre1bBackup(io, home)
  if (!backup.ok) return { ok: false, migrated: false, message: backup.code + ': ' + backup.message }
  await adoptLegacyProduction(io, home)
  let wrote = false
  await transactIo(io, mergeStatePath(home), current => {
    if (current === null) throw new Error('merge-state-v4-required')
    const header = JSON.parse(current) as { schemaVersion?: unknown; rows?: unknown; migration?: unknown }
    if (header.schemaVersion === 4) return current
    if (header.schemaVersion !== 3 || !Array.isArray(header.rows) || !header.rows.every(isV3Row)) throw new Error('merge-state-normalize-required')
    const v4State = normalizeV3State({ schemaVersion: 3, rows: header.rows, ...(header.migration === undefined ? {} : { migration: header.migration }) }, { backupRef: backup.id, at: new Date().toISOString() })
    wrote = true
    return JSON.stringify(v4State, null, 2) + '\n'
  })
  return { ok: true, migrated: wrote, backupRef: backup.id }
}

/** Read schema4 rows only; no legacy projection. */
export async function readPairLedgerV4(io: EvolutionIoLike, home: string): Promise<{ readonly rows: readonly V4Row[]; readonly revision: string } | null> {
  const raw = await readTextOrNull(io, mergeStatePath(home))
  if (raw === null) return null
  const state = parseV4State(raw)
  if (state === null) return null
  const rows = state.rows
  const revision = createHash('sha256').update(JSON.stringify(rows.map(row => [row.id, row.version, row.state, row.updatedAt]))).digest('hex')
  return { rows, revision }
}
