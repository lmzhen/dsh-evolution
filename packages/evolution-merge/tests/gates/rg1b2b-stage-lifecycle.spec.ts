// @tier pre-tag
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { createStageTree, cleanupStage, dropStage, presentStage, readStageEntry, reserveStage, type StageEntry } from '../../src/domain/stage-aggregate.ts'
import { reconcileMergeState } from '../../src/domain/reconcile.ts'
import { makeV4Home, v3Row } from '../support/schema4-home.ts'

const entry = (rowId: string, state: StageEntry['state'] = 'reserved'): StageEntry => ({ version: 1, rowId, pairKey: 'a\u0000b', runId: 'run', ref: 'run/pairs/' + rowId, state, createdAt: 1, expiresAt: 1_000, updatedAt: 1 })

it('reserves the index before the tree and sweeps a kill-before-reserved orphan', async () => {
  const home = await tempRoot('dsh-rg1b2b-stage-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge', 'runs', 'run', 'pairs', 'r1'), { recursive: true })
  await reserveStage(io, home, entry('r1'))
  const raw = JSON.parse(await readFile(join(home, 'merge', 'staging-index', 'r1.json'), 'utf8')) as { state: string }
  expect(raw.state).toBe('reserved')
  const cleanup = await cleanupStage(io, home, 2_000, new Map([['r1', { state: 'approved' }]]), 10)
  expect(cleanup.removed).toContain('r1')
  expect(await readStageEntry(io, home, 'r1')).toBeNull()
})

it('marks present, expires TTL, drops terminal indices, and sweeps trees without index', async () => {
  const home = await tempRoot('dsh-rg1b2b-stage2-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge', 'runs', 'run', 'pairs', 'r2'), { recursive: true })
  await mkdir(join(home, 'merge', 'runs', 'orphan'), { recursive: true })
  await reserveStage(io, home, entry('r2'))
  await createStageTree(io, home, { runId: 'run/pairs/r2', target: 'a', sources: [{ name: 'a', body: 'a', files: [] }], promptVersion: 'v', ttlDays: 1, now: () => 1 })
  await presentStage(io, home, entry('r2', 'present'))
  await reserveStage(io, home, entry('pending', 'present'))
  const cleanup = await cleanupStage(io, home, 2_000, new Map([['r2', { state: 'fuse' }], ['pending', { state: 'pending' }], ['gone', { state: 'skipped' }]]), 10)
  expect(cleanup.expired).toContain('r2')
  expect(cleanup.removed).toContain('pending')
  expect(cleanup.orphans.length).toBeGreaterThan(0)
  await dropStage(io, home, 'r2')
  expect(await readStageEntry(io, home, 'r2')).toBeNull()
})

it('continues approved+reserved to fuse and present on startup', async () => {
  const { home, io } = await makeV4Home([v3Row({ state: 'approved', target: 'a', decision: { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['b'], rationale: 'r' } } as never)])
  const entry: StageEntry = { version: 1, rowId: 'r1', pairKey: 'a\u0000b', runId: 'run', ref: 'run/pairs/r1', state: 'reserved', createdAt: 1, expiresAt: Date.now() + 1_000_000, updatedAt: 1 }
  await reserveStage(io, home, entry)
  await createStageTree(io, home, { runId: entry.ref, target: 'a', sources: [{ name: 'a', body: 'body', files: [] }], promptVersion: 'x', ttlDays: 7, now: () => 1 })
  const report = await reconcileMergeState({ io, home, now: () => Date.now(), ttlDays: 0 })
  expect(report.actions.map(action => [action.rowId, action.code])).toEqual([['r1', 'stage-present']])
  expect((await readStageEntry(io, home, 'r1'))?.state).toBe('present')
})
