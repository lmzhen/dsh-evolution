// @tier pre-tag
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { validateArtifacts, type ArtifactState } from '../../src/domain/consistency.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const base: ArtifactState = { row: 'verify', run: 'none', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 0 }
const allowed: ArtifactState[] = [
  base,
  { ...base, run: 'running', activeRuns: 1 },
  { ...base, run: 'failed' },
  { ...base, row: 'pending' },
  { ...base, row: 'pending', run: 'awaiting-approval', activeRuns: 1 },
  { ...base, row: 'approved' },
  { ...base, row: 'approved', run: 'running', activeRuns: 1 },
  { ...base, row: 'fuse', staging: 'kept' },
  { ...base, row: 'fuse', run: 'running', staging: 'kept', activeRuns: 1 },
  { ...base, row: 'fuse', run: 'failed', staging: 'kept' },
  { ...base, row: 'fuse', run: 'orphan', staging: 'kept' },
  { ...base, row: 'fuse', staging: 'none', recovery: true },
  { ...base, row: 'fuse', run: 'failed', staging: 'none', recovery: true },
  { ...base, row: 'fuse', run: 'orphan', staging: 'none', recovery: true },
  { ...base, row: 'fuse', run: 'running', staging: 'none', activeRuns: 1, recovery: true },
  { ...base, row: 'fuse', staging: 'missing', recovery: true },
  { ...base, row: 'fuse', run: 'failed', staging: 'missing', recovery: true },
  { ...base, row: 'fuse', run: 'orphan', staging: 'missing', recovery: true },
  { ...base, row: 'fuse', run: 'running', staging: 'missing', activeRuns: 1, recovery: true },
  { ...base, row: 'fuse', run: 'running', staging: 'kept', journal: 'committing', activeRuns: 1 },
  { ...base, row: 'skipped' },
  { ...base, row: 'merged', run: 'succeeded', staging: 'cleaned', journal: 'committed', evidence: 'receipt' },
  { ...base, row: 'merged', run: 'succeeded', staging: 'kept', journal: 'committed', evidence: 'receipt' },
]
const forbidden: [ArtifactState, string][] = [
  [{ ...base, row: 'pending', staging: 'kept' }, 'pending-staging'],
  [{ ...base, row: 'skipped', run: 'running' }, 'skipped-running'],
  [{ ...base, activeRuns: 2 }, 'multiple-active-runs'],
  [{ ...base, run: 'running', activeRuns: 1, hasOwner: false }, 'active-run-no-owner'],
  [{ ...base, journal: 'committed' }, 'committed-no-evidence'],
  [{ ...base, row: 'merged', journal: 'rolled-back', evidence: 'receipt' }, 'committed-rollback'],
  [{ ...base, row: 'fuse', staging: 'missing' }, 'fuse-lost-staging'],
  [{ ...base, row: 'pending', evidence: 'receipt' }, 'not-allowed'],
  [{ ...base, row: 'approved', staging: 'kept' }, 'not-allowed'],
  [{ ...base, row: 'skipped', run: 'succeeded' }, 'not-allowed'],
  [{ ...base, run: 'succeeded' }, 'not-allowed'],
  [{ ...base, row: 'merged', journal: 'none', evidence: 'none' }, 'not-allowed'],
]

it('accepts every whitelisted steady-state variant', () => {
  for (const state of allowed) expect(validateArtifacts(state).ok, JSON.stringify(state)).toBe(true)
})

it('rejects every forbidden combination with a stable reason', () => {
  for (const [state, reason] of forbidden) {
    expect(validateArtifacts(state).ok, JSON.stringify(state)).toBe(false)
    expect(validateArtifacts(state).reason).toBe(reason)
  }
})

it('RG0 recovery never writes skill bytes', () => {
  const source = readFileSync(root + '/src/commit-recovery.ts', 'utf8')
  expect(source).not.toContain('writeText(skillBodyPath')
  expect(source).not.toContain('writeText(skillFilePath')
  expect(source).not.toContain('restoreFromArchive')
})

it('RG0 commit goes through the CommitPort only', () => {
  const source = readFileSync(root + '/src/commit-execute.ts', 'utf8')
  expect(source).toContain('port.commitMerge')
  expect(source).not.toContain('applyTreeChange')
})
