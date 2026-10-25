/**
 * The one merge-state ledger: <home>/merge/merge-state.json.
 *
 * Reads are pure projections (no write, no reconciliation side effect). Every write goes
 * through mutateMergeState and a single transactIo, so there is no second file and no
 * incremental writer. A row's queue is always derived from its state on read; a hand-edited
 * mismatch is repaired by the next write, never by a GET.
 */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import {
  MERGE_STATE_VERSION,
  queueOf,
  type MergePairState,
  type MergeQueue,
  type MergeRow,
  type MergeState,
} from './contracts.ts'
import { parseLedger } from './domain/ledger.ts'
import type { RowWriteResult } from './domain/row-tx.ts'
import { parseV4State } from './domain/schema4.ts'
import { v4ToLegacy } from './domain/row-v4.ts'
import type { SkippedRowV3, V3Event, V3Row, VerifyRowV3 } from './domain/row-v3.ts'

export function mergeStatePath(home: string): string {
  return join(home, 'merge', 'merge-state.json')
}

interface ParsedState {
  readonly ok: boolean
  readonly rows: MergeRow[]
  readonly note?: string
}

function parseState(raw: string | null): ParsedState {
  const parsed = parseLedger(raw)
  if (!parsed.ok) return { ok: false, rows: [], ...(parsed.note === undefined ? {} : { note: parsed.note }) }
  return {
    ok: true,
    rows: parsed.ledger.rows as MergeRow[],
    ...(parsed.note === undefined ? {} : { note: parsed.note }),
  }
}

export interface LoadMergeStateResult {
  readonly ok: boolean
  readonly state: MergeState
  readonly note?: string
}

/** Pure read: never writes, never deletes a row. */
export async function loadMergeState(io: EvolutionIoLike, home: string): Promise<LoadMergeStateResult> {
  let raw: string | null = null
  try {
    raw = await io.readText(mergeStatePath(home))
  } catch {
    return { ok: false, state: { schemaVersion: MERGE_STATE_VERSION, rows: [] } }
  }
  if (raw !== null) {
    try {
      const header = JSON.parse(raw) as { schemaVersion?: unknown }
      if (header.schemaVersion === 4) {
        const v4 = parseV4State(raw)
        if (v4 === null) return { ok: false, state: { schemaVersion: MERGE_STATE_VERSION, rows: [] }, note: 'merge-state-needs-repair' }
        return { ok: true, state: { schemaVersion: MERGE_STATE_VERSION, rows: v4.rows.map(v4ToLegacy) } }
      }
      if (typeof header.schemaVersion === 'number' && header.schemaVersion > 4) return { ok: false, state: { schemaVersion: MERGE_STATE_VERSION, rows: [] }, note: 'merge-state-forward-only' }
    } catch { /* parseState below reports the detailed note */ }
  }
  const parsed = parseState(raw)
  return {
    ok: parsed.ok,
    state: { schemaVersion: MERGE_STATE_VERSION, rows: parsed.rows },
    ...(parsed.note === undefined ? {} : { note: parsed.note }),
  }
}

/** Schema probe for doctor; the only other reader of mergeStatePath. */
export async function loadStateSchema(io: EvolutionIoLike, home: string): Promise<number | null> {
  try {
    const raw = await io.readText(mergeStatePath(home))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown }
    return typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : null
  } catch { return null }
}

export interface RowTx {
  rows(): readonly V3Row[]
  createVerify(row: VerifyRowV3): RowWriteResult
  createSkipped(row: SkippedRowV3): RowWriteResult
  transition(id: string, event: V3Event, expectedVersion: number): RowWriteResult
}

/** G3-5 runtime write API: only createVerify/createSkipped/transition. v2 writes are rejected. */
export async function transactRows<T>(_io: EvolutionIoLike, _home: string, _fn: (tx: RowTx) => T): Promise<T> {
  throw new Error('legacy-writer-removed')
}

/** The ONE write point. The callback returns the whole row set, not a delta. */
export async function mutateMergeState<T>(
  _io: EvolutionIoLike,
  _home: string,
  _now: () => number,
  _fn: (rows: readonly MergeRow[]) => { rows: readonly MergeRow[]; result: T },
): Promise<T> {
  throw new Error('legacy-writer-removed')
}

export interface MoveRowPatch {
  readonly queue: MergeQueue
  readonly state?: MergePairState
  readonly failure?: MergeRow['failure']
  readonly runId?: string
  readonly unitId?: string
  readonly origin?: MergeRow['origin']
  readonly attempts?: number
}

export type UpsertExpect = 'any' | 'absent' | 'verify' | 'pending' | 'fuse' | 'skipped'
export type UpsertResult = { readonly ok: true } | { readonly ok: false; readonly current: MergeRow }

export async function upsertRow(
  io: EvolutionIoLike,
  home: string,
  now: () => number,
  row: MergeRow,
  expect: UpsertExpect = 'any',
  cas?: string | null,
): Promise<UpsertResult> {
  return await mutateMergeState(io, home, now, (rows): { rows: readonly MergeRow[]; result: UpsertResult } => {
    const index = rows.findIndex(item => item.pairKey === row.pairKey)
    const current = index < 0 ? undefined : rows[index]
    if (cas !== undefined && ((cas === null && current !== undefined) || (cas !== null && current?.updatedAt !== cas))) {
      return { rows, result: { ok: false, current: current ?? row } }
    }
    if (current !== undefined && expect !== 'any' && (expect === 'absent' || queueOf(current.state) !== expect)) {
      return { rows, result: { ok: false, current } }
    }
    if (current === undefined && expect !== 'any' && expect !== 'absent' && expect !== 'verify') {
      return { rows, result: { ok: false, current: row } }
    }
    const normalized: MergeRow = { ...row, queue: queueOf(row.state) }
    const next = [...rows]
    if (current === undefined) next.push(normalized)
    else next[index] = { ...normalized, createdAt: current.createdAt }
    return { rows: next, result: { ok: true } }
  })
}

export async function moveRow(
  io: EvolutionIoLike,
  home: string,
  now: () => number,
  id: string,
  patch: MoveRowPatch,
): Promise<MergeRow | undefined> {
  return await mutateMergeState(io, home, now, (rows) => {
    const index = rows.findIndex(item => item.id === id)
    if (index < 0) return { rows, result: undefined }
    const current = rows[index] as MergeRow
    const state = patch.state ?? current.state
    const next: MergeRow = {
      ...current,
      state,
      queue: queueOf(state),
      updatedAt: new Date(now()).toISOString(),
      ...(patch.failure === undefined ? {} : { failure: patch.failure }),
      ...(patch.runId === undefined ? {} : { runId: patch.runId }),
      ...(patch.unitId === undefined ? {} : { unitId: patch.unitId }),
      ...(patch.origin === undefined ? {} : { origin: patch.origin }),
      ...(patch.attempts === undefined ? {} : { attempts: patch.attempts }),
    }
    const copy = [...rows]
    copy[index] = next
    return { rows: copy, result: next }
  })
}

/** G3-5 v3-aware drop: only terminal events. */
export async function dropRowV3(_io: EvolutionIoLike, _home: string, _id: string, _event: 'committed' | 'superseded' | 'restored', _unitId = 'unknown'): Promise<boolean> {
  throw new Error('legacy-writer-removed')
}

export async function dropRow(io: EvolutionIoLike, home: string, now: () => number, id: string): Promise<boolean> {
  return await mutateMergeState(io, home, now, (rows) => {
    const next = rows.filter(item => item.id !== id)
    return { rows: next, result: next.length !== rows.length }
  })
}

export async function rowsOf(io: EvolutionIoLike, home: string, queue?: MergeQueue): Promise<readonly MergeRow[]> {
  const loaded = await loadMergeState(io, home)
  return queue === undefined ? loaded.state.rows : loaded.state.rows.filter(row => row.queue === queue)
}
