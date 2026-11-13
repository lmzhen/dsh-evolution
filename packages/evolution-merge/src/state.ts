/**
 * The one merge-state ledger: <home>/merge/merge-state.json.
 *
 * Reads are pure projections (no write, no reconciliation side effect). Every write goes
 * through pairLedger and a single transactIo, so there is no second file and no
 * incremental writer. A row's queue is always derived from its state on read; a hand-edited
 * mismatch is repaired by the next write, never by a GET.
 */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import {
  MERGE_STATE_VERSION,
  type MergeQueue,
  type MergeRow,
  type MergeState,
} from './contracts.ts'
import { parseLedger } from './domain/ledger.ts'
import { parseV4State } from './domain/schema4.ts'
import { v4ToLegacy } from './domain/row-v4.ts'

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

export async function rowsOf(io: EvolutionIoLike, home: string, queue?: MergeQueue): Promise<readonly MergeRow[]> {
  const loaded = await loadMergeState(io, home)
  return queue === undefined ? loaded.state.rows : loaded.state.rows.filter(row => row.queue === queue)
}
