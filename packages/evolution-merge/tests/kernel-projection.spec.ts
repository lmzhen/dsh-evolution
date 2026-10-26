// @tier pre-tag
import { describe, expect, it } from 'vitest'
import type { LedgerState } from '../src/kernel/ledger.ts'
import { isExpired, project, queueOf } from '../src/kernel/projection.ts'
import { planRecovery, timeoutDecision } from '../src/kernel/recovery.ts'
import type { PairSnapshot } from '../src/kernel/model.ts'

const at = '2026-10-26T00:00:00.000Z'
function pair(id: string, state: PairSnapshot['state'], extra: Partial<PairSnapshot> = {}): PairSnapshot {
  return { id, pairKey: id + '\u0000b', a: id, b: 'b', state, version: 1, createdAt: at, updatedAt: at, attempts: 0, ...extra }
}
function ledger(pairs: readonly PairSnapshot[]): LedgerState {
  return { seq: pairs.length, pairs: new Map(pairs.map(item => [item.id, item])), units: new Map() }
}

describe('merge projection', () => {
  it('maps states to queues and counts expiry once', () => {
    const now = 10_000
    const state = ledger([
      pair('a', 'candidate'),
      pair('b', 'pending', { expiresAt: now - 1 }),
      pair('c', 'failed', { failure: { code: 'runtime', stage: 'run', retryable: true, reportOnly: true, userMessageKey: 'failure.runtime' } }),
      pair('d', 'closed', { closedReason: 'keep' }),
      pair('e', 'committed', { unitId: 'u1', receipt: { unitId: 'u1', evidenceSha256: 'e' } }),
    ])
    const projection = project(state, now)
    expect(projection.counts.active).toEqual({ verify: 1, pending: 0, fuse: 1, skipped: 1 })
    expect(projection.counts.expired).toBe(1)
    expect(projection.rows.find(row => row.id === 'b')?.expired).toBe(true)
    expect(projection.rows.find(row => row.id === 'e')?.queue).toBeNull()
  })

  it('uses a single queue mapping and expiry predicate', () => {
    const row = pair('x', 'pending', { expiresAt: 20 })
    expect(queueOf(row)).toBe('pending')
    expect(isExpired(row, 19)).toBe(false)
    expect(isExpired(row, 20)).toBe(true)
    expect(queueOf(pair('y', 'failed'))).toBe('fuse')
    expect(queueOf(pair('z', 'closed', { closedReason: 'reject' }))).toBe('skipped')
    expect(queueOf(pair('w', 'committed', { unitId: 'u', receipt: { unitId: 'u', evidenceSha256: 'e' } }))).toBeNull()
  })

  it('is deterministic for the same ledger', () => {
    const state = ledger([pair('a', 'candidate'), pair('b', 'pending')])
    expect(JSON.stringify(project(state, 0))).toBe(JSON.stringify(project(state, 0)))
  })
})

describe('recovery planner', () => {
  const receipt = { unitId: 'u1', evidenceSha256: 'e1' }
  const base = { hasIntent: true, hasReceipt: false, beforeMatches: false, afterMatches: false, effects: 'none' as const }

  it('retries before intent and commits with a receipt', () => {
    expect(planRecovery({ ...base, hasIntent: false })).toEqual({ kind: 'retry', reason: 'no-intent' })
    expect(planRecovery({ ...base, hasReceipt: true, receipt })).toEqual({ kind: 'committed', receipt })
  })

  it('rolls forward complete/after effects and aborts none/before effects', () => {
    expect(planRecovery({ ...base, effects: 'complete' })).toEqual({ kind: 'roll-forward', reason: 'effects-complete' })
    expect(planRecovery({ ...base, afterMatches: true, effects: 'partial' })).toEqual({ kind: 'roll-forward', reason: 'after-hash-matches' })
    expect(planRecovery({ ...base, effects: 'none' })).toEqual({ kind: 'abort', reason: 'no-effects' })
    expect(planRecovery({ ...base, beforeMatches: true, effects: 'partial' })).toEqual({ kind: 'abort', reason: 'before-hash-matches' })
  })

  it('blocks a truly mixed state and never declares success', () => {
    expect(planRecovery({ ...base, effects: 'partial' })).toEqual({ kind: 'blocked', reason: 'partial-effects' })
    expect(planRecovery({ ...base, hasReceipt: true })).toEqual({ kind: 'blocked', reason: 'partial-effects' })
  })

  it('turns a timeout into failed only before intent', () => {
    expect(timeoutDecision(false)).toBe('failed')
    expect(timeoutDecision(true)).toBe('unknown')
  })
})
