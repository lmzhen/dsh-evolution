// @tier pre-tag
import { expect, it } from 'vitest'
import { newRunRegistry, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { makeV4Home } from './support/schema4-home.ts'
import { readMergeSnapshot } from '../src/domain/merge-snapshot.ts'

it('a run started by another plane is visible in the merge run view', async () => {
  const home = await tempRoot('dsh-merge-foreign-run-')
  const io = nodeEvolutionIo()
  const v4 = await makeV4Home([])
  const owner = newRunRegistry({ io, home: v4.home, now: () => 10 })
  const started = await owner.begin('merge', { command: 'scan' })
  const reader = newRunRegistry({ io, home: v4.home, now: () => 11 })
  expect((await reader.load()).ok).toBe(true)
  expect(reader.runs('merge').map(run => run.id)).toContain(started.id)
  const snapshot = await readMergeSnapshot({ io, home: v4.home, runs: reader.runs('merge'), approval: false })
  expect(snapshot.runs.map(run => run.record.id)).toContain(started.id)
})
