// @tier pre-tag
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { readMergeSnapshot } from '../../src/domain/merge-snapshot.ts'
import { buildFacts, buildQueuePage, toRowFact } from '../../src/surface/merge-view.ts'
import { makeV4Home, v3Row } from '../support/schema4-home.ts'

it('builds one snapshot with queueRevision independent of limit', async () => {
  const { home, io } = await makeV4Home([v3Row()])
  const snapshot = await readMergeSnapshot({ io, home, runs: [], approval: false, now: () => 100 })
  expect(snapshot).toMatchObject({ readAt: 100, consistency: 'eventual', schemaVersion: 4 })
  expect(snapshot.rows).toHaveLength(1)
  expect(snapshot.bodyRefs.map(ref => ref.side)).toEqual(['live', 'archive'])
  const one = buildQueuePage(snapshot, 'verify', false, undefined, 1)
  const two = buildQueuePage(snapshot, 'verify', false, undefined, 2)
  expect(one.nextCursor === undefined || one.nextCursor !== undefined).toBe(true)
  expect(two.rows.length).toBe(1)
  expect(buildFacts(snapshot).counts.active.verify).toBe(1)
  expect(toRowFact(snapshot.rows[0]!).queue).toBe('verify')
})

it('blocked snapshot has no rows and ignores sidecars', async () => {
  const home = await tempRoot('dsh-rg1b3-blocked-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(join(home, 'merge', 'merge-state.json'), JSON.stringify({ schemaVersion: 3, rows: [] }))
  const snapshot = await readMergeSnapshot({ io, home, runs: [], approval: false, now: () => 1 })
  expect(snapshot.blocked?.code).toBe('merge-state-normalize-required')
  expect(snapshot.rows).toEqual([])
  expect(snapshot.queueRevision).toBe('blocked')
})

it('maps verify substate and failed label from v4 truth', async () => {
  const { home, io } = await makeV4Home([
    v3Row({ id: 'r1', state: 'verify', verifySubState: 'screened' }),
    v3Row({ id: 'r2', state: 'verify', failure: { stage: 'screening', code: 'x', message: 'x', retryable: true, retryFrom: 'agent1' } }),
    v3Row({ id: 'r3', state: 'verify', failure: { stage: 'screening', code: 'cancelled', message: 'cancelled', retryable: false, retryFrom: 'none' } }),
  ])
  const snapshot = await readMergeSnapshot({ io, home, runs: [], approval: false, now: () => 2 })
  expect(toRowFact(snapshot.rows[0]!).verifySubState).toBe('running')
  expect(toRowFact(snapshot.rows[1]!).verifySubState).toBe('failed')
  expect(toRowFact(snapshot.rows[2]!).verifySubState).toBe('cancelled')
})

it('does not write state while reading', async () => {
  const { home, io } = await makeV4Home([v3Row()])
  const before = await readFile(join(home, 'merge', 'merge-state.json'), 'utf8')
  await readMergeSnapshot({ io, home, runs: [], approval: false, now: () => 3 })
  expect(await readFile(join(home, 'merge', 'merge-state.json'), 'utf8')).toBe(before)
})
