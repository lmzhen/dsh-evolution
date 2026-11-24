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
      change: current => ({ ...current.domains, state: { version: 2 } }),
    })
    expect(write.domains.state).toEqual({ version: 2 })
    await expect(service.command({
      commandId: 'approve',
      domains: ['merge'],
      change: () => ({ merge: {} }),
    })).rejects.toThrow(/may not write/)
    await expect(service.query('not-a-command')).rejects.toThrow(/unregistered store surface/)
  })
})
