/** Pure append-only ledger and deterministic fold. No IO. */
import type { PairEvent, PairSnapshot } from './model.ts'
import { transition as transitionPair } from './machine.ts'
import { checkPair } from './invariants.ts'
import { checkUnit, transitionUnit, type UnitEvent, type UnitSnapshot } from './unit.ts'

export type LedgerEntry =
  | { readonly seq: number; readonly at: string; readonly type: 'pair-created'; readonly snapshot: PairSnapshot }
  | { readonly seq: number; readonly at: string; readonly type: 'pair-transition'; readonly pairId: string; readonly expectedVersion: number; readonly event: PairEvent }
  | { readonly seq: number; readonly at: string; readonly type: 'unit-created'; readonly snapshot: UnitSnapshot }
  | { readonly seq: number; readonly at: string; readonly type: 'unit-transition'; readonly unitId: string; readonly expectedVersion: number; readonly event: UnitEvent }

export interface LedgerState {
  readonly seq: number
  readonly pairs: ReadonlyMap<string, PairSnapshot>
  readonly units: ReadonlyMap<string, UnitSnapshot>
}

export type FoldResult =
  | { readonly ok: true; readonly state: LedgerState }
  | { readonly ok: false; readonly seq: number; readonly message: string }

export function emptyLedger(): LedgerState {
  return { seq: 0, pairs: new Map(), units: new Map() }
}

export function fold(entries: readonly LedgerEntry[]): FoldResult {
  let state = emptyLedger()
  for (const entry of entries) {
    if (!Number.isInteger(entry.seq) || entry.seq !== state.seq + 1) return { ok: false, seq: entry.seq, message: 'expected seq ' + String(state.seq + 1) + ', got ' + String(entry.seq) }
    if (entry.type === 'pair-created') {
      if (state.pairs.has(entry.snapshot.id)) return { ok: false, seq: entry.seq, message: 'duplicate pair ' + entry.snapshot.id }
      const problems = checkPair(entry.snapshot)
      if (problems.length > 0) return { ok: false, seq: entry.seq, message: 'pair invalid: ' + problems.join('; ') }
      state = { ...state, seq: entry.seq, pairs: new Map(state.pairs).set(entry.snapshot.id, entry.snapshot) }
      continue
    }
    if (entry.type === 'pair-transition') {
      const current = state.pairs.get(entry.pairId)
      if (current === undefined) return { ok: false, seq: entry.seq, message: 'pair not found: ' + entry.pairId }
      const moved = transitionPair(current, entry.event, entry.expectedVersion)
      if (!moved.ok) return { ok: false, seq: entry.seq, message: moved.message }
      const problems = checkPair(moved.snapshot)
      if (problems.length > 0) return { ok: false, seq: entry.seq, message: 'pair invalid after transition: ' + problems.join('; ') }
      state = { ...state, seq: entry.seq, pairs: new Map(state.pairs).set(entry.pairId, moved.snapshot) }
      continue
    }
    if (entry.type === 'unit-created') {
      if (state.units.has(entry.snapshot.unitId)) return { ok: false, seq: entry.seq, message: 'duplicate unit ' + entry.snapshot.unitId }
      const problems = checkUnit(entry.snapshot)
      if (problems.length > 0) return { ok: false, seq: entry.seq, message: 'unit invalid: ' + problems.join('; ') }
      state = { ...state, seq: entry.seq, units: new Map(state.units).set(entry.snapshot.unitId, entry.snapshot) }
      continue
    }
    const current = state.units.get(entry.unitId)
    if (current === undefined) return { ok: false, seq: entry.seq, message: 'unit not found: ' + entry.unitId }
    const moved = transitionUnit(current, entry.event, entry.expectedVersion)
    if (!moved.ok) return { ok: false, seq: entry.seq, message: moved.message }
    const problems = checkUnit(moved.snapshot)
    if (problems.length > 0) return { ok: false, seq: entry.seq, message: 'unit invalid after transition: ' + problems.join('; ') }
    state = { ...state, seq: entry.seq, units: new Map(state.units).set(entry.unitId, moved.snapshot) }
  }
  return { ok: true, state }
}

/** Deterministic projection bytes for replay-equality tests. */
export function ledgerProjectionJson(state: LedgerState): string {
  const pairs = [...state.pairs.values()].sort((left, right) => left.id.localeCompare(right.id))
  const units = [...state.units.values()].sort((left, right) => left.unitId.localeCompare(right.unitId))
  return JSON.stringify({ seq: state.seq, pairs, units })
}
