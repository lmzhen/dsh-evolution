// @tier pre-tag
import { expect, it } from 'vitest'
import { validateArtifacts, type ArtifactState } from '../../src/domain/consistency.ts'

const state = (patch: Partial<ArtifactState>): ArtifactState => ({ row: 'verify', run: 'none', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 0, ...patch })

it('allows every live/terminal run-state artifact phase', () => {
  for (const item of [
    state({ row: 'verify', run: 'running', activeRuns: 1, hasOwner: true }),
    state({ row: 'pending', run: 'awaiting-approval', activeRuns: 1, hasOwner: true }),
    state({ row: 'fuse', run: 'orphan', staging: 'kept' }),
    state({ row: 'merged', run: 'succeeded', staging: 'cleaned', journal: 'committed', evidence: 'receipt' }),
  ]) expect(validateArtifacts(item).ok, JSON.stringify(item)).toBe(true)
})

it('rejects cancelled and unknown run phases for active rows', () => {
  expect(validateArtifacts({ row: 'fuse', run: 'cancelled', staging: 'kept', journal: 'none', evidence: 'none', activeRuns: 0 }).ok).toBe(false)
  expect(validateArtifacts({ row: 'fuse', run: 'failed', staging: 'kept', journal: 'prepared', evidence: 'none', activeRuns: 0 }).ok).toBe(false)
})

it('rejects forbidden phase combinations with named reasons', () => {
  expect(validateArtifacts(state({ row: 'pending', staging: 'kept' }))).toMatchObject({ ok: false, reason: 'pending-staging' })
  expect(validateArtifacts(state({ row: 'verify', run: 'running', activeRuns: 1, hasOwner: false }))).toMatchObject({ ok: false, reason: 'active-run-no-owner' })
  expect(validateArtifacts(state({ row: 'merged', run: 'succeeded', staging: 'cleaned', journal: 'committed', evidence: 'none' }))).toMatchObject({ ok: false, reason: 'committed-no-evidence' })
  expect(validateArtifacts(state({ row: 'fuse', run: 'running', staging: 'missing', activeRuns: 1 }))).toMatchObject({ ok: false, reason: 'fuse-lost-staging' })
  expect(validateArtifacts(state({ row: 'skipped', run: 'running', activeRuns: 1 }))).toMatchObject({ ok: false, reason: 'skipped-running' })
})
