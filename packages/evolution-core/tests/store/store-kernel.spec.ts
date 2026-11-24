// @tier fast
import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo } from '../../src/io.ts'
import { HomeFence } from '../../src/home-fence.ts'
import { StoreKernel } from '../../src/store/store-kernel.ts'
import {
  StoreConflictError,
  StoreCorruptError,
  StoreError,
  type StoreWriterFence,
} from '../../src/store/types.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

const openFence = (): StoreWriterFence => ({
  run: async <T>(body: () => Promise<T>): Promise<T> => await body(),
})

async function seeded(): Promise<{ root: string; io: ReturnType<typeof nodeEvolutionIo>; kernel: StoreKernel }> {
  const root = await tempRoot('dsh-store-v2-')
  const io = nodeEvolutionIo()
  const kernel = new StoreKernel({ io, home: root, fence: openFence(), now: () => 1_700_000_000_000 })
  return { root, io, kernel }
}

describe('home MVCC store kernel', () => {
  it('bootstraps one commit and reads it without invoking the writer fence', async () => {
    const { root, io } = await seeded()
    const writer = openFence()
    const kernel = new StoreKernel({ io, home: root, fence: writer })
    await kernel.bootstrap({ state: { turns: 1 } })
    const noWriter: StoreWriterFence = { run: async () => { throw new Error('read took the writer fence') } }
    const reader = new StoreKernel({ io, home: root, fence: noWriter })
    const snapshot = await reader.query(['state'])
    expect(snapshot.domains.state).toEqual({ turns: 1 })
    expect(snapshot.commitId).toMatch(/^[0-9a-f]{64}$/)
    expect(snapshot.tree).toBeNull()
  })

  it('publishes a new commit while an already-returned snapshot stays immutable', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence() })
    await kernel.bootstrap({ state: { turns: 1 } })
    const before = await kernel.query(['state'])
    const result = await kernel.mutate({
      domains: ['state'],
      source: 'command',
      change: current => ({ state: { turns: (current.domains.state as { turns: number }).turns + 1 } }),
    })
    expect(result.domains.state).toEqual({ turns: 2 })
    expect(before.domains.state).toEqual({ turns: 1 })
    expect((await kernel.query(['state'])).commitId).toBe(result.commitId)
  })

  it('rejects a stale expectedHead instead of overwriting a newer commit', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence() })
    await kernel.bootstrap({ state: { turns: 1 } })
    const stale = await kernel.query(['state'])
    await kernel.mutate({ domains: ['state'], source: 'command', change: () => ({ state: { turns: 2 } }) })
    await expect(kernel.mutate({
      domains: ['state'],
      source: 'command',
      expectedHead: stale.commitId,
      change: () => ({ state: { turns: 3 } }),
    })).rejects.toBeInstanceOf(StoreConflictError)
    expect((await kernel.query(['state'])).domains.state).toEqual({ turns: 2 })
  })

  it('does not create a new commit when the changed value has identical bytes', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence() })
    const initial = await kernel.bootstrap({ state: { turns: 1 } })
    const same = await kernel.mutate({ domains: ['state'], source: 'command', change: () => ({ state: { turns: 1 } }) })
    expect(same.commitId).toBe(initial.commitId)
  })

  it('fails closed when the head is missing or an object is corrupt', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence() })
    await expect(kernel.query(['state'])).rejects.toThrow(/not initialized/)
    await kernel.bootstrap({ state: { turns: 1 } })
    const head = JSON.parse(await readFile(join(root, 'store-v2', 'head.json'), 'utf8')) as { commitId: string }
    const objects = join(root, 'store-v2', 'objects')
    const names = await (await import('node:fs/promises')).readdir(objects)
    expect(names.length).toBe(1)
    await writeFile(join(objects, names[0]!), '{"tampered":true}')
    await expect(kernel.query(['state'])).rejects.toBeInstanceOf(StoreCorruptError)
    expect(head.commitId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a second bootstrap and keeps the first head', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence() })
    const first = await kernel.bootstrap({ state: { turns: 1 } })
    await expect(kernel.bootstrap({ state: { turns: 2 } })).rejects.toBeInstanceOf(StoreError)
    expect((await kernel.query(['state'])).commitId).toBe(first.commitId)
  })

  it('reads a committed snapshot while a HomeFence writer is held', async () => {
    const { io, root } = await seeded()
    const fence = new HomeFence({ home: root, waitMs: 2_000 })
    const kernel = new StoreKernel({ io, home: root, fence })
    await kernel.bootstrap({ state: { turns: 1 } })
    let entered!: () => void
    const enteredGate = new Promise<void>(resolve => { entered = resolve })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const held = fence.run(async () => {
      entered()
      await gate
    })
    await enteredGate
    try {
      const result = await Promise.race([
        kernel.query(['state']),
        new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 750)),
      ])
      expect(result).not.toBe('timeout')
      if (result !== 'timeout') expect(result.domains.state).toEqual({ turns: 1 })
    } finally {
      release()
      await held
    }
  })

  it('garbage-collects unreachable commits but keeps the head readable', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence(), now: () => 1_700_000_000_000 })
    await kernel.bootstrap({ state: { n: 0 } })
    for (let n = 1; n <= 3; n += 1) {
      await kernel.mutate({ domains: ['state'], source: 'command', change: () => ({ state: { n } }) })
    }
    const removed = await kernel.collectGarbage(2)
    expect(removed.commits.length).toBeGreaterThan(0)
    expect((await kernel.query(['state'])).domains.state).toEqual({ n: 3 })
  })
})
