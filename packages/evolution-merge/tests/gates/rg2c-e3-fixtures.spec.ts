// @tier pre-tag
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, type UnitEvidenceRecord } from '@deepseek-ai/dsh-evolution-core'
import { projectRecoveredUnit } from '../../src/recovery-projection.ts'
import { loadMergeState } from '../../src/state.ts'
import { makeV4Home, v3Row } from '../support/schema4-home.ts'

const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }
const evidence: UnitEvidenceRecord = { schemaVersion: 1, unitId: 'u-1', runId: 'run-1', planDigest: 'd', state: 'complete', target: { before: 'old', after: 'new', supportDigest: '', created: false }, sources: [{ name: 'b', before: 'b', after: null, archived: true, absorbedInto: 'a' }], mutations: 1, validationPlan: { planVersion: 1, stageDigest: 'stage-1', revision: 'rev-1' }, at: 1 }
async function home(): Promise<{ home: string; io: ReturnType<typeof nodeEvolutionIo> }> {
  const v4 = await makeV4Home([v3Row({ id: 'r1', state: 'fuse', target: 'a', decision, runId: 'run-1' })])
  await mkdir(join(v4.home, 'merge', 'staging-index'), { recursive: true })
  await writeFile(join(v4.home, 'merge', 'staging-index', 'r1.json'), JSON.stringify({ version: 2, rowId: 'r1', pairKey: 'a\u0000b', state: 'present', ref: 'run-1/pairs/a', target: 'a', expiresAt: 9, updatedAt: 'u' }))
  return { home: v4.home, io: v4.io }
}
const project = (h: { home: string; io: ReturnType<typeof nodeEvolutionIo> }, onPhase?: (phase: string) => void | Promise<void>) => projectRecoveredUnit({ io: h.io, home: h.home, runId: 'run-1', unitId: 'u-1', evidence, now: () => 2, ...(onPhase === undefined ? {} : { onPhase }) })

it('row remove failure leaves report/unit and retry only removes the row', async () => {
  const h = await home()
  let fired = false
  let failed = false
  try { await project(h, phase => { if (phase === 'row-remove' && !fired) { fired = true; throw new Error('kill-row') } }) } catch { failed = true }
  expect(failed).toBe(true)
  expect((await loadMergeState(h.io, h.home)).state.rows).toHaveLength(1)
  const reportBefore = await readFile(join(h.home, 'reports', 'merge-run-1.json'), 'utf8')
  const retry = await project(h)
  expect(retry.ok, retry.ok ? '' : retry.message).toBe(true)
  expect((await loadMergeState(h.io, h.home)).state.rows).toEqual([])
  expect(await readFile(join(h.home, 'reports', 'merge-run-1.json'), 'utf8')).toBe(reportBefore)
  expect(JSON.parse(await readFile(join(h.home, 'reports', 'merge-run-1.json'), 'utf8')).pairs[0].validationPlan).toMatchObject({ planVersion: 1, stageDigest: 'stage-1' })
})

it('stage drop failure after row removal only clears the stage on retry', async () => {
  const h = await home()
  let fired = false
  let failed = false
  try { await project(h, phase => { if (phase === 'stage-drop' && !fired) { fired = true; throw new Error('kill-stage') } }) } catch { failed = true }
  expect(failed).toBe(true)
  expect((await loadMergeState(h.io, h.home)).state.rows).toEqual([])
  expect(await readFile(join(h.home, 'merge', 'staging-index', 'r1.json'), 'utf8')).toContain('present')
  const retry = await project(h)
  expect(retry.ok, retry.ok ? '' : retry.message).toBe(true)
  expect((await loadMergeState(h.io, h.home)).state.rows).toEqual([])
  await expect(readFile(join(h.home, 'merge', 'staging-index', 'r1.json'), 'utf8')).rejects.toThrow()
})

it('approved reserved without a stage tree is blocked as lost, never fused', async () => {
  const h = await home()
  const approved = await makeV4Home([v3Row({ id: 'r1', state: 'approved', target: 'a', decision, runId: 'run-1' } as never)])
  await mkdir(join(approved.home, 'merge', 'staging-index'), { recursive: true })
  await writeFile(join(approved.home, 'merge', 'staging-index', 'r1.json'), JSON.stringify({ version: 2, rowId: 'r1', pairKey: 'a\u0000b', state: 'reserved', ref: 'run-1/pairs/a', target: 'a', expiresAt: 9, updatedAt: 'u' }))
  const result = await projectRecoveredUnit({ io: approved.io, home: approved.home, runId: 'run-1', unitId: 'u-1', evidence, now: () => 2 })
  expect(result.ok).toBe(false)
  expect(result.action).toBe('stage-lost')
  expect(await readFile(join(approved.home, 'merge', 'staging-index', 'r1.json'), 'utf8')).toContain('lost')
  void h
})
