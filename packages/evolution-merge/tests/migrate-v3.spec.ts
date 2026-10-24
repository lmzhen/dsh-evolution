// @tier pre-tag
import { expect, it } from 'vitest'
import { migrateV2ToV3 } from '../src/domain/migrate-v3.ts'

const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'same' }
const row = (state: string, extra: Record<string, unknown> = {}) => ({ id: state, pairKey: 'a|b', a: 'a', b: 'b', state, createdAt: 'c', updatedAt: 'u', origin: 'human', ...extra })

it('maps all five v2 states and preserves identity', () => {
  const result = migrateV2ToV3({ schemaVersion: 2, rows: [
    row('verify', { attempts: 2, sourceRevision: 's1' }),
    row('pending', { target: { requested: 'a' }, decision, targetRevision: 't1', attempts: 0 }),
    row('approved', { target: { requested: 'a' }, decision, runId: 'r1', attempts: 1 }),
    row('fuse', { target: { requested: 'a' }, decision, stagingRef: 'st', stagingExpiresAt: 99, runId: 'r1' }),
    row('skipped', { reason: 'expired' }),
  ] })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.state.schemaVersion).toBe(3)
  expect(result.state.rows.map(item => item.id)).toEqual(['verify', 'pending', 'approved', 'fuse', 'skipped'])
  expect(result.state.rows[1]).toMatchObject({ state: 'pending', target: 'a', targetRevision: 't1' })
  expect(result.state.rows[3]).toMatchObject({ state: 'fuse', staging: { kind: 'present', ref: 'st' } })
  expect(result.state.rows[4]).toMatchObject({ state: 'skipped', reason: 'expired', expiredAt: Date.parse('u') })
})

it('quarantines half rows and missing decision', () => {
  const half = migrateV2ToV3({ schemaVersion: 2, rows: [{ id: 'x' }] })
  expect(half.ok).toBe(true)
  if (!half.ok) return
  expect(half.state.rows).toEqual([])
  expect(half.quarantine).toHaveLength(1)
  const noDecision = migrateV2ToV3({ schemaVersion: 2, rows: [row('pending', { target: { requested: 'a' }, decision: undefined })] })
  expect(noDecision.ok).toBe(true)
  if (!noDecision.ok) return
  expect(noDecision.quarantine).toHaveLength(1)
})
