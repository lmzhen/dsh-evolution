// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { makeV4Home } from '../support/schema4-home.ts'
import { readMergeSnapshot } from '../../src/domain/merge-snapshot.ts'

it('GET reads write zero bytes through state/run I/O', async () => {
  const { home, io: baseIo } = await makeV4Home([])
  const io = baseIo
  let writes = 0
  const guarded: EvolutionIoLike = { ...io, writeText: async (path, text) => { writes += 1; await io.writeText(path, text) }, remove: async path => { writes += 1; await io.remove(path) }, rename: async (from, to) => { writes += 1; await io.rename(from, to) } }
  await readMergeSnapshot({ io: guarded, home, runs: [], approval: false })
  expect(writes).toBe(0)
})

