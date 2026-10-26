// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { makeV4Home } from './support/schema4-home.ts'
import { readMergeSnapshot } from '../src/domain/merge-snapshot.ts'

it('projects deleted/split archive history through the snapshot history port', async () => {
  const v4 = await makeV4Home([])
  const snapshot = await readMergeSnapshot({
    io: v4.io, home: v4.home, runs: [], approval: false,
    history: async () => [
      { name: 'old', kind: 'deleted', reason: 'deleted by user', lastVersion: 2, archivedAt: 1 },
      { name: 'forked', kind: 'split', reason: 'split into a/b', lastVersion: 1, archivedAt: 2 },
    ],
  })
  expect(snapshot.history.map(item => item.kind)).toEqual(['deleted', 'split'])
})
