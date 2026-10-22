/**
 * The one merge-state ledger: <home>/merge/merge-state.json.
 *
 * Reads are pure projections (no write, no reconciliation side effect). Every write goes
 * through mutateMergeState and a single transactIo, so there is no second file and no
 * incremental writer. A row's queue is always derived from its state on read; a hand-edited
 * mismatch is repaired by the next write, never by a GET.
 */
import { join } from 'node:path'
import { transactIo } from '@deepseek-ai/dsh-evolution-core'
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
  if (!parsed.ok) return { ok: false, rows: [] }
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
  const parsed = parseState(raw)
  return {
    ok: parsed.ok,
    state: { schemaVersion: MERGE_STATE_VERSION, rows: parsed.rows },
    ...(parsed.note === undefined ? {} : { note: parsed.note }),
  }
}

/** The ONE write point. The callback returns the whole row set, not a delta. */
export async function mutateMergeState<T>(
  io: EvolutionIoLike,
  home: string,
  now: () => number,
  fn: (rows: readonly MergeRow[]) => { rows: readonly MergeRow[]; result: T },
): Promise<T> {
  let result: T | undefined
  let ran = false
  await transactIo(io, mergeStatePath(home), (current) => {
    ran = true
    const parsed = parseState(current)
    const out = fn(parsed.rows)
    result = out.result
    return JSON.stringify({ schemaVersion: MERGE_STATE_VERSION, rows: out.rows }, null, 2)
  })
  // transactIo only returns after fn ran; a skipped write is not a state outcome.
  void ran
  void now
  return result as T
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

export async function upsertRow(io: EvolutionIoLike, home: string, now: () => number, row: MergeRow): Promise<void> {
  await mutateMergeState(io, home, now, (rows) => {
    const index = rows.findIndex(item => item.pairKey === row.pairKey)
    const normalized: MergeRow = { ...row, queue: queueOf(row.state) }
    const next = [...rows]
    if (index < 0) next.push(normalized)
    else next[index] = { ...normalized, createdAt: rows[index]?.createdAt ?? normalized.createdAt }
    return { rows: next, result: undefined }
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