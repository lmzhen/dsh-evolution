// @tier pre-tag
import { writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { acquireTreeWriteLock, nodeEvolutionIo, treeLockFile } from '../src/index.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

it('exposes epoch and rejects an old holder after takeover', async () => {
  const home = await tempRoot('dsh-tree-epoch-')
  const io = nodeEvolutionIo()
  const first = await acquireTreeWriteLock({ io, home, waitMs: 0 })
  expect(first.ok).toBe(true)
  if (!first.ok) return
  expect(first.lock.epoch).toBe(1)
  await writeFile(treeLockFile(home), JSON.stringify({ token: 'dead', epoch: 1, pid: 999999, startedAt: 1 }))
  const second = await acquireTreeWriteLock({ io, home, waitMs: 0 })
  expect(second.ok).toBe(true)
  if (!second.ok) return
  expect(second.lock.epoch).toBe(2)
  expect(await first.lock.assertHeld()).toBe(false)
  expect(await second.lock.assertHeld()).toBe(true)
  await second.lock.release()
})
