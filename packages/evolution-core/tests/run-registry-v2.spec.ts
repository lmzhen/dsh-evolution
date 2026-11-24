// @tier fast
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { nodeEvolutionIo } from '../src/io.ts'
import { HomeFence } from '../src/home-fence.ts'
import { StoreKernel } from '../src/store/store-kernel.ts'
import { createRunStorePort, emptyRunIndex, newRunRegistry } from '../src/run-registry.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

async function seeded(): Promise<{ root: string; io: ReturnType<typeof nodeEvolutionIo>; store: ReturnType<typeof createRunStorePort> }> {
  const root = await tempRoot('dsh-runs-v2-')
  const io = nodeEvolutionIo()
  const kernel = new StoreKernel({ io, home: root, fence: new HomeFence({ home: root }) })
  await kernel.bootstrap({ runs: emptyRunIndex() })
  return { root, io, store: createRunStorePort(kernel) }
}

describe('run registry over the MVCC store', () => {
  it('writes the run index through a commit and reads it from a second registry', async () => {
    const { root, io, store } = await seeded()
    const owner = newRunRegistry({ io, home: root, store, now: () => 10 })
    const handle = await owner.begin('maintain', { total: 3 })
    await owner.stage(handle.id, 'screening', { done: 1, total: 3 })
    await owner.settle(handle.id, { state: 'succeeded', resultRef: 'maintain/report.json' })

    const reader = newRunRegistry({ io, home: root, store, now: () => 20 })
    expect(await reader.load()).toMatchObject({ ok: true })
    expect(reader.find(handle.id)).toMatchObject({ state: 'succeeded', resultRef: 'maintain/report.json' })
    expect(reader.runs()).toHaveLength(1)
    expect(existsSync(join(root, 'runs.json'))).toBe(false)
  })

  it('keeps a foreign run and converges the orphan verdict through the commit', async () => {
    const { root, io, store } = await seeded()
    const owner = newRunRegistry({ io, home: root, store, now: () => 1 })
    const handle = await owner.begin('merge')
    // Rewrite the committed row with a dead owner to model a crashed process.
    await store.write((current) => {
      if (current === null) throw new Error('runs index missing')
      const rows = current.runs.map(row => row.id === handle.id ? { ...row, pid: 999_999_999 } : row)
      return { ...current, runs: rows }
    })
    const reader = newRunRegistry({ io, home: root, store, now: () => 2 })
    expect((await reader.load()).ok).toBe(true)
    expect(reader.find(handle.id)).toMatchObject({ state: 'failed' })
  })
})
