// @tier fast
import { describe, expect, it, vi } from 'vitest'
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

  it('rejects a nested commit that advanced the head during the mutator', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence() })
    await kernel.bootstrap({ state: { turns: 1 } })
    await expect(kernel.mutate({
      domains: ['state'],
      source: 'command',
      change: async () => {
        await kernel.mutate({ domains: ['runs'], source: 'command', change: () => ({ runs: { ids: ['nested'] } }) })
        return { state: { turns: 2 } }
      },
    })).rejects.toBeInstanceOf(StoreConflictError)
    const snapshot = await kernel.query(['state', 'runs'])
    expect(snapshot.domains.runs).toEqual({ ids: ['nested'] })
  })

  it('normalizes tree refs on publish and rejects a non-plain JSON value', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence() })
    await kernel.bootstrap({ state: { turns: 1 } })
    await kernel.mutate({
      domains: ['state'],
      source: 'foreground',
      tree: { unitId: 'u1', manifest: '0'.repeat(64), extra: 7 } as never,
      change: () => ({ state: { turns: 2 } }),
    })
    const snapshot = await kernel.query(['state'])
    expect(snapshot.tree).toEqual({ unitId: 'u1', manifest: '0'.repeat(64) })
    await expect(kernel.mutate({
      domains: ['state'],
      source: 'command',
      change: () => ({ state: { when: new Date(0) } }),
    })).rejects.toThrow(/plain JSON/)
  })

  it('rejects an invalid retain value instead of silently using 64', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence() })
    await kernel.bootstrap({ state: { n: 0 } })
    await expect(kernel.collectGarbage(Number.NaN)).rejects.toMatchObject({ code: 'store-invalid-retain' })
    await expect(kernel.collectGarbage(1)).rejects.toMatchObject({ code: 'store-invalid-retain' })
    expect((await kernel.query(['state'])).domains.state).toEqual({ n: 0 })
  })

  it('retries a transiently missing head instead of reporting an empty store', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence() })
    await kernel.bootstrap({ state: { turns: 1 } })
    let misses = 0
    const flaky = {
      ...io,
      readText: async (path: string): Promise<string | null> => {
        if (path.endsWith('head.json') && misses++ === 0) return null
        return await io.readText(path)
      },
    }
    const reader = new StoreKernel({ io: flaky, home: root, fence: openFence() })
    expect((await reader.query(['state'])).domains.state).toEqual({ turns: 1 })
  })

  it('keeps the old head readable when a publish crashes before the head write', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence() })
    await kernel.bootstrap({ state: { turns: 1 } })
    const crashing = {
      ...io,
      writeText: async (path: string, text: string): Promise<void> => {
        if (path.endsWith('head.json')) throw new Error('simulated crash before head')
        return await io.writeText(path, text)
      },
    }
    const writer = new StoreKernel({ io: crashing, home: root, fence: openFence() })
    await expect(writer.mutate({ domains: ['state'], source: 'command', change: () => ({ state: { turns: 2 } }) })).rejects.toThrow(/simulated crash/)
    expect((await kernel.query(['state'])).domains.state).toEqual({ turns: 1 })
    await kernel.mutate({ domains: ['state'], source: 'command', change: () => ({ state: { turns: 3 } }) })
    expect((await kernel.query(['state'])).domains.state).toEqual({ turns: 3 })
  })

  it('writes a tree manifest inside the commit transaction', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence() })
    await kernel.bootstrap({ state: { n: 0 } })
    const manifest = { version: 1, unitId: 'unit-1', entries: [] }
    const result = await kernel.mutate({ domains: [], source: 'tool', change: () => ({}), tree: { unitId: 'unit-1' }, treeManifest: manifest })
    expect(result.tree?.manifest).toMatch(/^[0-9a-f]{64}$/)
    expect(await kernel.getObject(result.tree!.manifest!)).toEqual(manifest)
  })

  it('garbage-collects unreachable commits but keeps the head readable', async () => {    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence(), now: () => 1_700_000_000_000 })
    await kernel.bootstrap({ state: { n: 0 } })
    for (let n = 1; n <= 3; n += 1) {
      await kernel.mutate({ domains: ['state'], source: 'command', change: () => ({ state: { n } }) })
    }
    const removed = await kernel.collectGarbage(2)
    expect(removed.commits.length).toBeGreaterThan(0)
    expect((await kernel.query(['state'])).domains.state).toEqual({ n: 3 })
  })

  it('does not fail an already-published mutation when GC bookkeeping fails', async () => {
    const root = await tempRoot('dsh-store-gc-failure-')
    const base = nodeEvolutionIo()
    const io = {
      ...base,
      list: async (path: string): Promise<string[]> => {
        if (path.includes('objects')) throw new Error('simulated GC list failure')
        return await base.list(path)
      },
    }
    const kernel = new StoreKernel({ io, home: root, fence: openFence(), gcEveryWrites: 1 })
    await kernel.bootstrap({ state: { n: 0 } })
    await expect(kernel.mutate({ domains: ['state'], source: 'command', change: () => ({ state: { n: 1 } }) })).resolves.toBeDefined()
    expect((await kernel.query(['state'])).domains.state).toEqual({ n: 1 })
  })

  it('runs bounded GC from the write path instead of only on demand', async () => {
    const { io, root } = await seeded()
    const kernel = new StoreKernel({ io, home: root, fence: openFence(), gcEveryWrites: 1 })
    await kernel.bootstrap({ state: { n: 0 } })
    const gc = vi.spyOn(kernel, 'collectGarbage')
    await kernel.mutate({ domains: ['state'], source: 'command', change: () => ({ state: { n: 1 } }) })
    expect(gc).toHaveBeenCalledTimes(1)
    expect((await kernel.query(['state'])).domains.state).toEqual({ n: 1 })
  })
})
