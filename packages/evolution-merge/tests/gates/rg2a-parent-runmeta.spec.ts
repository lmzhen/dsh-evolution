// @tier pre-tag
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { runApproveCommand } from '../../src/approve-command.ts'
import { casExpiredHook } from '../../src/domain/failure-route.ts'
import { readRunMeta, runMetaPath, writeRunMeta } from '../../src/domain/run-coordinator.ts'
import { loadMergeState, mergeStatePath } from '../../src/state.ts'
import { recordRound2Outcome } from '../../src/round2-outcome.ts'
import { makeV4Home, v3Row } from '../support/schema4-home.ts'

const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }

it('approve without parentRunId is merge-parent-required and creates no run', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'p1', state: 'pending', target: 'a', decision })])
  let began = false
  const result = await runApproveCommand({
    io: v4.io, home: v4.home, rowId: 'p1', platformWrite: false, now: () => 1,
    registry: { async begin() { began = true; return { id: 'r', signal: new AbortController().signal, startedAt: 1 } }, async stage() {}, async settle() {} },
    ports: { async round2() { return { kind: 'failed' } } },
  })
  expect(result.ok).toBe(false)
  expect(began).toBe(false)
  if (!result.ok) expect(result.message).toContain('merge-parent-required')
})

it('run-meta writes only pairCount/reportRef and ignores legacy pairKeys on read', async () => {
  const v4 = await makeV4Home([])
  await mkdir(runMetaPath(v4.home, 'r1').replace(/r1\.json$/, ''), { recursive: true })
  await writeFile(runMetaPath(v4.home, 'r1'), JSON.stringify({ version: 1, runId: 'r1', pairKeys: ['a', 'b'], pairKey: 'a', phase: 'running', createdAt: 'c', updatedAt: 'u' }))
  expect(await readRunMeta(v4.io, v4.home, 'r1')).toMatchObject({ runId: 'r1', phase: 'running' })
  await writeRunMeta(v4.io, v4.home, { version: 1, runId: 'r1', pairCount: 2, phase: 'settled', reportRef: '/r.json', createdAt: 'c', updatedAt: 'u' })
  const raw = await readFile(runMetaPath(v4.home, 'r1'), 'utf8')
  expect(raw).toContain('"pairCount": 2')
  expect(raw).not.toContain('pairKeys')
  expect(raw).not.toContain('"pairKey"')
})

it('CAS hook is typed expired and recordRound2Outcome keeps the row as failed, not skipped', async () => {
  expect(casExpiredHook('target-changed')).toEqual({ kind: 'expired', reason: 'target-taken', write: false })
  const v4 = await makeV4Home([v3Row({ id: 'f1', state: 'fuse', target: 'a', decision, runId: 'run-1' })])
  const record = await recordRound2Outcome(v4.io, v4.home, () => 1, (await loadMergeState(v4.io, v4.home)).state.rows[0]!, { kind: 'failed', failure: { stage: 'commit', code: 'target-changed', message: 'target changed', retryable: true, retryFrom: 'agent2' } })
  expect(record.merged).toBe(false)
  expect(record.pair.failure?.code).toBe('target-taken')
  expect((await loadMergeState(v4.io, v4.home)).state.rows[0]).toMatchObject({ state: 'fuse', failure: { code: 'target-taken' } })
})
