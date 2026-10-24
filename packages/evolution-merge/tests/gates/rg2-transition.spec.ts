// @tier pre-tag
import { expect, it } from 'vitest'
import { transitionV3, type V3Event, type V3Row } from '../../src/domain/row-v3.ts'

const base = { id: 'r', pairKey: 'a|b', a: 'a', b: 'b', version: 0, createdAt: 'c', updatedAt: 'u', origin: 'agent' as const }
const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }
const failure = { stage: 'commit' as const, code: 'x', message: 'x', retryable: true, retryFrom: 'agent2' as const }
const row = (state: V3Row['state']): V3Row => state === 'verify' ? { ...base, state, verifySubState: 'candidate', attempts: 0 }
  : state === 'pending' ? { ...base, state, target: 'a', decision, attempts: 0 }
  : state === 'approved' ? { ...base, state, target: 'a', decision, attempts: 0 }
  : state === 'fuse' ? { ...base, state, target: 'a', decision, attempts: 0, staging: { kind: 'present', ref: 's', expiresAt: 1 } }
  : { ...base, state, reason: 'r', attempts: 0 }
const events: Record<string, V3Event> = {
  'verify-passed': { type: 'verify-passed', decision, target: 'a', sourceRevision: 's' },
  approved: { type: 'approved', runId: 'u' },
  staged: { type: 'staged', ref: 's', expiresAt: 1 },
  committed: { type: 'committed', unitId: 'u' },
  skipped: { type: 'skipped', reason: 'r' },
  expired: { type: 'expired', kind: 'target-taken' },
  failed: { type: 'failed', failure },
  superseded: { type: 'superseded' },
  restored: { type: 'restored' },
  'auto-approved': { type: 'auto-approved', decision, target: 'a' },
}
const legal = new Set(['verify:verify-passed', 'verify:skipped', 'verify:superseded', 'verify:auto-approved', 'verify:failed', 'pending:auto-approved', 'skipped:restored', 'skipped:superseded', 'pending:approved', 'pending:staged', 'pending:skipped', 'pending:expired', 'pending:failed', 'pending:superseded', 'approved:staged', 'approved:committed', 'approved:skipped', 'approved:failed', 'approved:superseded', 'fuse:staged', 'fuse:committed', 'fuse:skipped', 'fuse:failed', 'fuse:superseded'])

it('covers every state by event edge with typed errors', () => {
  for (const state of ['verify', 'pending', 'approved', 'fuse', 'skipped'] as const) {
    for (const [name, event] of Object.entries(events)) {
      const result = transitionV3(row(state), event, 0, 'now')
      if (legal.has(state + ':' + name)) {
        expect(result.ok, state + ':' + name).toBe(true)
        if (result.ok && result.row !== null) expect(result.row.version).toBe(1)
      } else {
        expect(result, state + ':' + name).toMatchObject({ ok: false, code: 'illegal-transition' })
      }
    }
  }
})

it('keeps failure and attempts when a non-retryable failure skips', () => {
  const fatal = { ...failure, retryable: false }
  for (const state of ['approved', 'fuse'] as const) {
    const result = transitionV3(row(state), { type: 'failed', failure: fatal }, 0)
    expect(result.ok).toBe(true)
    if (!result.ok || result.row === null) continue
    expect(result.row).toMatchObject({ state: 'skipped', failure: fatal, attempts: 1 })
  }
})

it('rejects a stale version on every state', () => {
  for (const state of ['verify', 'pending', 'approved', 'fuse', 'skipped'] as const) {
    expect(transitionV3(row(state), events.committed, 1)).toMatchObject({ ok: false, code: 'version-conflict' })
  }
})
