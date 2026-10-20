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
  MERGE_PAIR_STATES,
  queueOf,
  type MergePairState,
  type MergeQueue,
  type MergeRow,
  type MergeState,
} from './contracts.ts'

export function mergeStatePath(home: string): string {
  return join(home, 'merge', 'merge-state.json')
}

/** Deterministic, URL-safe id derived from the pair key (FNV-1a 32). */
export function rowIdOf(pairKey: string): string {
  let hash = 0x811c9dc5
  for (const byte of Buffer.from(pairKey, 'utf8')) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return 'mr_' + hash.toString(36).padStart(7, '0')
}

interface ParsedState {
  readonly ok: boolean
  readonly rows: MergeRow[]
  readonly note?: string
}

function isState(value: unknown): value is MergePairState {
  return typeof value === 'string' && (MERGE_PAIR_STATES as readonly string[]).includes(value)
}

function parseState(raw: string | null): ParsedState {
  if (raw === null) return { ok: true, rows: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, rows: [] }
  }
  const body = parsed as { schemaVersion?: unknown; rows?: unknown }
  if (!Array.isArray(body.rows)) return { ok: false, rows: [] }
  const rows: MergeRow[] = []
  let skipped = 0
  for (const value of body.rows) {
    const row = value as Partial<MergeRow>
    if (typeof row.id !== 'string' || typeof row.pairKey !== 'string' || typeof row.a !== 'string' || typeof row.b !== 'string') {
      skipped += 1
      continue
    }
    if (!isState(row.state) || typeof row.createdAt !== 'string' || typeof row.updatedAt !== 'string') {
      skipped += 1
      continue
    }
    const normalized: MergeRow = {
      id: row.id,
      pairKey: row.pairKey,
      a: row.a,
      b: row.b,
      state: row.state,
      queue: queueOf(row.state),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.failure === undefined ? {} : { failure: row.failure }),
      ...(typeof row.runId === 'string' ? { runId: row.runId } : {}),
      ...(typeof row.unitId === 'string' ? { unitId: row.unitId } : {}),
      ...(row.origin === 'agent' || row.origin === 'human' ? { origin: row.origin } : {}),
      ...(typeof row.attempts === 'number' ? { attempts: row.attempts } : {}),
    }
    rows.push(normalized)
  }
  const versionNote = typeof body.schemaVersion === 'number' && body.schemaVersion !== MERGE_STATE_VERSION
    ? 'the index declares schemaVersion ' + String(body.schemaVersion) + ' while this build writes ' + String(MERGE_STATE_VERSION)
    : undefined
  const note = versionNote === undefined
    ? (skipped === 0 ? undefined : String(skipped) + ' invalid row(s) skipped')
    : (skipped === 0 ? versionNote : versionNote + '; ' + String(skipped) + ' invalid row(s) skipped')
  return { ok: true, rows, ...(note === undefined ? {} : { note }) }
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
  if (!ran) throw new Error('merge-state transaction did not run; no write was performed')
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

export async function moveRow(io: EvolutionIoLike, home: string, now: () => number, id: string, patch: MoveRowPatch): Promise<MergeRow | undefined> {
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
