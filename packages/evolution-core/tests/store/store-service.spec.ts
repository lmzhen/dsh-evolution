// @tier fast
import { describe, expect, it } from 'vitest'
import { HomeFence } from '../../src/home-fence.ts'
import { nodeEvolutionIo } from '../../src/io.ts'
import { StoreKernel } from '../../src/store/store-kernel.ts'
import { createStoreService } from '../../src/store/service.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

describe('store surface service', () => {
  it('enforces the command domain closure for reads and writes', async () => {
    const home = await tempRoot('dsh-store-service-')
    const io = nodeEvolutionIo()
    const kernel = new StoreKernel({ io, home, fence: new HomeFence({ home }) })
    await kernel.bootstrap({ state: { version: 1 } })
    const service = createStoreService(kernel)
    const read = await service.query('pending')
    expect(read.snapshot.domains.state).toEqual({ version: 1 })
    await expect(service.query('pending', ['merge'])).rejects.toThrow(/may not read/)
    const write = await service.command({
      commandId: 'approve',
      domains: ['state'],
      expectedCommit: read.snapshot.commitId,
      change: current => ({ ...current.domains, state: { version: 2 } }),
    })
    expect(write.domains.state).toEqual({ version: 2 })
    await expect(service.command({
      commandId: 'approve',
      domains: ['state'],
      change: () => ({ state: { version: 3 } }),
    })).rejects.toMatchObject({ code: 'store-expected-commit-required' })
    await expect(service.command({
      commandId: 'approve',
      domains: ['merge'],
      expectedCommit: write.commitId,
      change: () => ({ merge: {} }),
    })).rejects.toThrow(/may not write/)
    await expect(service.query('not-a-command')).rejects.toThrow(/unregistered store surface/)
  })

  it('reads and transacts a typed domain through one codec', async () => {
    const home = await tempRoot('dsh-store-service-codec-')
    const io = nodeEvolutionIo()
    const kernel = new StoreKernel({ io, home, fence: new HomeFence({ home }) })
    await kernel.bootstrap({ state: { n: 0 } })
    const service = createStoreService(kernel)
    const codec = {
      decode: (value: unknown | undefined): number => (value as { n?: number } | undefined)?.n ?? 0,
      encode: (value: number): unknown => ({ n: value }),
    }
    expect((await service.read('state', codec)).value).toBe(0)
    await service.transact('state', codec, current => current + 1)
    expect((await service.read('state', codec)).value).toBe(1)
  })

  it('guards a write against a stale activation generation', async () => {
    const home = await tempRoot('dsh-store-service-generation-')
    const io = nodeEvolutionIo()
    const kernel = new StoreKernel({ io, home, fence: new HomeFence({ home }) })
    await kernel.bootstrap({ state: { n: 0 } })
    const service = createStoreService(kernel, 7)
    const observed = await service.query('pending')
    expect(observed.generation).toBe(7)
    await expect(service.command({
      commandId: 'approve',
      domains: ['state'],
      expectedCommit: observed.snapshot.commitId,
      expectedGeneration: 6,
      change: () => ({ state: { n: 1 } }),
    })).rejects.toMatchObject({ code: 'store-generation-mismatch' })
    await expect(service.command({
      commandId: 'approve',
      domains: ['state'],
      expectedCommit: observed.snapshot.commitId,
      expectedGeneration: 7,
      change: () => ({ state: { n: 2 } }),
    })).resolves.toBeDefined()
  })
})
