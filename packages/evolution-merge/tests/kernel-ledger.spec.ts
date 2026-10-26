// @tier pre-tag
import { describe, expect, it } from 'vitest'
import { fold, ledgerProjectionJson, type LedgerEntry } from '../src/kernel/ledger.ts'
import type { PairSnapshot } from '../src/kernel/model.ts'

const at = '2026-10-26T00:00:00.000Z'
function pair(): PairSnapshot {
  return { id: 'p1', pairKey: 'a\u0000b', a: 'a', b: 'b', state: 'candidate', version: 1, createdAt: at, updatedAt: at, attempts: 0 }
}
const receipt = { unitId: 'u1', evidenceSha256: 'e1' }

describe('merge ledger fold', () => {
  it('replays a pair transition stream deterministically', () => {
    const entries: LedgerEntry[] = [
      { seq: 1, at, type: 'pair-created', snapshot: pair() },
      { seq: 2, at, type: 'pair-transition', pairId: 'p1', expectedVersion: 1, event: { type: 'screen', at } },
      { seq: 3, at, type: 'pair-transition', pairId: 'p1', expectedVersion: 2, event: { type: 'decide', at, decision: 'keep', approval: 'off' } },
    ]
    const first = fold(entries)
    const second = fold(entries)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.state.seq).toBe(3)
    expect(first.state.pairs.get('p1')?.state).toBe('closed')
    expect(ledgerProjectionJson(first.state)).toBe(ledgerProjectionJson(second.state))
  })

  it('stops at the first illegal transition and names its seq', () => {
    const entries: LedgerEntry[] = [
      { seq: 1, at, type: 'pair-created', snapshot: pair() },
      { seq: 2, at, type: 'pair-transition', pairId: 'p1', expectedVersion: 1, event: { type: 'decide', at, decision: 'keep', approval: 'off' } },
    ]
    const result = fold(entries)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.seq).toBe(2)
    expect(result.message).toContain('decide from candidate')
  })

  it('rejects gaps, duplicates and stale versions', () => {
    expect(fold([{ seq: 2, at, type: 'pair-created', snapshot: pair() }]).ok).toBe(false)
    expect(fold([{ seq: 1, at, type: 'pair-created', snapshot: pair() }, { seq: 2, at, type: 'pair-created', snapshot: { ...pair(), id: 'p1' } }]).ok).toBe(false)
    expect(fold([
      { seq: 1, at, type: 'pair-created', snapshot: pair() },
      { seq: 2, at, type: 'pair-transition', pairId: 'p1', expectedVersion: 9, event: { type: 'screen', at } },
    ]).ok).toBe(false)
  })

  it('folds a unit intent -> applied -> committed protocol', () => {
    const entries: LedgerEntry[] = [
      { seq: 1, at, type: 'unit-created', snapshot: { unitId: 'u1', state: 'planned', version: 1, planHash: 'plan1' } },
      { seq: 2, at, type: 'unit-transition', unitId: 'u1', expectedVersion: 1, event: { type: 'prepare', planHash: 'plan1' } },
      { seq: 3, at, type: 'unit-transition', unitId: 'u1', expectedVersion: 2, event: { type: 'applied' } },
      { seq: 4, at, type: 'unit-transition', unitId: 'u1', expectedVersion: 3, event: { type: 'commit', receipt } },
    ]
    const result = fold(entries)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.get('u1')?.state).toBe('committed')
    expect(result.state.units.get('u1')?.receipt).toEqual(receipt)
  })

  it('keeps blocked units non-successful until recovery', () => {
    const entries: LedgerEntry[] = [
      { seq: 1, at, type: 'unit-created', snapshot: { unitId: 'u1', state: 'planned', version: 1, planHash: 'plan1' } },
      { seq: 2, at, type: 'unit-transition', unitId: 'u1', expectedVersion: 1, event: { type: 'prepare', planHash: 'plan1' } },
      { seq: 3, at, type: 'unit-transition', unitId: 'u1', expectedVersion: 2, event: { type: 'block', reason: 'partial effects' } },
      { seq: 4, at, type: 'unit-transition', unitId: 'u1', expectedVersion: 3, event: { type: 'recover-commit', receipt } },
    ]
    const result = fold(entries)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.get('u1')?.state).toBe('committed')
  })

  it('rejects a commit without applied effects', () => {
    const entries: LedgerEntry[] = [
      { seq: 1, at, type: 'unit-created', snapshot: { unitId: 'u1', state: 'planned', version: 1, planHash: 'plan1' } },
      { seq: 2, at, type: 'unit-transition', unitId: 'u1', expectedVersion: 1, event: { type: 'prepare', planHash: 'plan1' } },
      { seq: 3, at, type: 'unit-transition', unitId: 'u1', expectedVersion: 2, event: { type: 'commit', receipt } },
    ]
    expect(fold(entries).ok).toBe(false)
  })
})
