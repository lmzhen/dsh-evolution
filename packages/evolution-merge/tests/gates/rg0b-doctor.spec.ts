// @tier pre-tag
import { expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { mergeDoctor } from '../../src/doctor.ts'
import { journalPath } from '../../src/domain/commit-journal-store.ts'
import { validateArtifacts, type ArtifactState } from '../../src/domain/consistency.ts'

const state = (patch: Partial<ArtifactState>): ArtifactState => ({ row: 'verify', run: 'none', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 0, ...patch })

it('allows every live/terminal run-state artifact phase', () => {
  for (const item of [
    state({ row: 'verify', run: 'running', activeRuns: 1, hasOwner: true }),
    state({ row: 'pending', run: 'awaiting-approval', activeRuns: 1, hasOwner: true }),
    state({ row: 'fuse', run: 'orphan', staging: 'kept' }),
    state({ row: 'fuse', run: 'failed', staging: 'missing', recovery: true }),
    state({ row: 'merged', run: 'succeeded', staging: 'cleaned', journal: 'committed', evidence: 'receipt' }),
  ]) expect(validateArtifacts(item).ok, JSON.stringify(item)).toBe(true)
})

it('reads recovery and reports failed reports', async () => {
  const home = await tempRoot('dsh-rg0b-doctor-io-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(join(home, 'merge', 'merge-state.json'), JSON.stringify({ schemaVersion: 3, rows: [] }))
  await writeFile(join(home, 'merge', 'recovery.json'), JSON.stringify([{ runId: 'r', ok: false, action: 'rollback' }]))
  expect((await mergeDoctor(io, home)).find(item => item.key === 'recovery')).toMatchObject({ status: 'warn' })
  await writeFile(join(home, 'merge', 'recovery.json'), JSON.stringify([{ runId: 'r', ok: true }]))
  expect((await mergeDoctor(io, home)).find(item => item.key === 'recovery')).toMatchObject({ status: 'ok' })
})

it('reads every journal phase and a receipt from disk', async () => {
  const home = await tempRoot('dsh-rg0b-doctor-journal-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge', 'journals'), { recursive: true })
  const decision = { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['b'], rationale: 'r' }
  await writeFile(join(home, 'merge', 'merge-state.json'), JSON.stringify({ schemaVersion: 3, rows: [{ id: 'r', pairKey: 'a|b', a: 'a', b: 'b', version: 0, createdAt: 'c', updatedAt: 'c', origin: 'agent', runId: 'run-1', state: 'fuse', target: 'a', decision, staging: { kind: 'present', ref: 'run-1/pairs/a', expiresAt: 9 }, attempts: 0 }] }))
  for (const phase of ['prepared', 'target-written', 'sources-archived', 'committed', 'rolled-back', 'failed']) {
    await writeFile(journalPath(home, 'run-1'), JSON.stringify({ runId: 'run-1', phase, target: 'a', sources: ['b'], updatedAt: '2026-10-23T00:00:00.000Z' }))
    const row = (await mergeDoctor(io, home)).find(item => item.key === 'consistency')
    expect(row?.status, phase).toBe(phase === 'target-written' || phase === 'sources-archived' ? 'ok' : 'warn')
  }
  await mkdir(join(home, 'merge', 'receipts'), { recursive: true })
  await writeFile(journalPath(home, 'run-1'), JSON.stringify({ runId: 'run-1', phase: 'committed', target: 'a', sources: ['b'], updatedAt: '2026-10-23T00:00:00.000Z' }))
  await writeFile(join(home, 'merge', 'receipts', 'run-1.json'), JSON.stringify({ runId: 'run-1', unitId: 'u-1', target: 'a', sources: ['b'] }))
  expect((await mergeDoctor(io, home)).find(item => item.key === 'consistency')).toMatchObject({ status: 'warn' })
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
