// @tier pre-tag
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { deleteStagingIndex, readStagingIndex, stagingIndexPath, writeStagingIndex } from '../src/domain/staging-index.ts'

it('round-trips a live entry and hides an expired one', async () => {
  const home = await tempRoot('dsh-staging-index-')
  await mkdir(join(home, 'merge', 'staging-index'), { recursive: true })
  const io = nodeEvolutionIo()
  const entry = { rowId: 'r/1', pairKey: 'a|b', ref: 'run-1/pairs/a', expiresAt: 2000, runId: 'run-1', createdAt: 1 }
  await writeStagingIndex(io, home, entry)
  expect(await readStagingIndex(io, home, entry.rowId, 1000)).toEqual(entry)
  expect(await readStagingIndex(io, home, entry.rowId, 3000)).toBeNull()
  await deleteStagingIndex(io, home, entry.rowId)
  expect(await readStagingIndex(io, home, entry.rowId, 1000)).toBeNull()
})

it('rejects corrupt entries', async () => {
  const home = await tempRoot('dsh-staging-index-bad-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge', 'staging-index'), { recursive: true })
  await writeFile(stagingIndexPath(home, 'r'), 'not json')
  expect(await readStagingIndex(io, home, 'r')).toBeNull()
})
