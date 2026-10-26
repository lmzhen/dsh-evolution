// @tier pre-tag
import { describe, expect, it } from 'vitest'
import type { V4Row } from '../src/domain/row-v4.ts'
import { fromV4Row, fromV4Rows } from '../src/kernel/adapter-v4.ts'

const at = '2026-10-26T00:00:00.000Z'
const decision = { shouldMerge: true, mode: 'create-umbrella', target: 'merged', sources: ['a', 'b'], rationale: 'because' } as const
const failure = { stage: 'commit', code: 'commit-failed', message: 'commit failed', retryable: false, retryFrom: 'none' } as const
function base(): Omit<V4Row, 'state'> {
  return { id: 'r1', pairKey: 'a\u0000b', a: 'a', b: 'b', version: 3, createdAt: at, updatedAt: at, origin: 'agent', attempts: 1 }
}

describe('V4 -> kernel shadow adapter', () => {
  it('maps candidate/screened verify rows', () => {
    expect(fromV4Row({ ...base(), state: 'verify', verifySubState: 'unverified' } as V4Row).snapshot.state).toBe('candidate')
    expect(fromV4Row({ ...base(), state: 'verify', verifySubState: 'screened' } as V4Row).snapshot.state).toBe('deciding')
  })

  it('maps pending/approved/fuse with their decision', () => {
    const pending = fromV4Row({ ...base(), state: 'pending', target: 'merged', decision } as V4Row)
    expect(pending.snapshot.state).toBe('pending')
    expect(pending.snapshot.approval).toBe('on')
    expect(pending.snapshot.decision?.target).toBe('merged')
    expect(fromV4Row({ ...base(), state: 'approved', target: 'merged', decision } as V4Row).snapshot.state).toBe('approved')
    const fuse = fromV4Row({ ...base(), state: 'fuse', target: 'merged', decision } as V4Row)
    expect(fuse.snapshot.state).toBe('authoring')
    expect(fuse.warnings.some(warning => warning.includes('stagingRef'))).toBe(true)
  })

  it('maps skipped kinds without turning them into failures', () => {
    expect(fromV4Row({ ...base(), state: 'skipped', reason: 'agent keep', origin: 'agent' } as V4Row).snapshot).toMatchObject({ state: 'closed', closedReason: 'keep' })
    expect(fromV4Row({ ...base(), state: 'skipped', reason: 'human reject', origin: 'human' } as V4Row).snapshot).toMatchObject({ state: 'closed', closedReason: 'reject' })
    expect(fromV4Row({ ...base(), state: 'skipped', reason: 'merge-over-limit', origin: 'system' } as V4Row).snapshot).toMatchObject({ state: 'closed', closedReason: 'over-limit' })
  })

  it('maps a skipped row that carries a failure to failed, with a warning', () => {
    const result = fromV4Row({ ...base(), state: 'skipped', reason: 'commit-failed', failure } as V4Row)
    expect(result.snapshot.state).toBe('failed')
    expect(result.snapshot.failure?.code).toBe('commit-failed')
    expect(result.warnings.some(warning => warning.includes('kernel state=failed'))).toBe(true)
  })

  it('preserves skipped-expired as closed+expiresAt', () => {
    const result = fromV4Row({ ...base(), state: 'skipped', reason: 'agent keep', expiredAt: 123 } as V4Row)
    expect(result.snapshot.state).toBe('closed')
    expect(result.snapshot.closedReason).toBe('keep')
    expect(result.snapshot.expiresAt).toBe(123)
  })

  it('adapts a batch without throwing and names warnings by row', () => {
    const rows = [
      { ...base(), state: 'verify', verifySubState: 'screened' },
      { ...base(), id: 'r2', state: 'fuse', target: 'merged', decision },
    ] as V4Row[]
    const result = fromV4Rows(rows)
    expect(result.snapshots).toHaveLength(2)
    expect(result.warnings.some(warning => warning.startsWith('r2: '))).toBe(true)
  })
})
