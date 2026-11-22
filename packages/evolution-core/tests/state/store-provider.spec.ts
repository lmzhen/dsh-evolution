// @tier fast
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createStateStoreProvider } from '../../src/state/store.ts'
import { runStateProviderConsistency } from '../../src/state/index.ts'
import { nodeEvolutionIo } from '../../src/io.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

const providerAt = async (): Promise<{ provider: ReturnType<typeof createStateStoreProvider>; home: string; io: ReturnType<typeof nodeEvolutionIo> }> => {
  const home = await tempRoot('dsh-state-store-')
  return { provider: createStateStoreProvider({ io: nodeEvolutionIo(), home }), home, io: nodeEvolutionIo() }
}

describe('file StateStore provider', () => {
  it('passes the shared provider conformance suite', async () => {
    const { provider } = await providerAt()
    // The shared suite is the provider seam's contract, not a second
    // hand-written copy of it.
    await runStateProviderConsistency(provider, expect as never, { createdAt: new Date().toISOString() })
  })

  it('has no process-local authority: a second provider observes the first one\'s write', async () => {
    const home = await tempRoot('dsh-state-store-shared-')
    const first = createStateStoreProvider({ io: nodeEvolutionIo(), home })
    const second = createStateStoreProvider({ io: nodeEvolutionIo(), home })
    await first.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
    expect(await second.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
    await first.claimPending('p1', 'claim-a')
    expect(await second.listPending('executing')).toEqual([])
    await first.savePending({
      id: 'p1', kind: 'memory', summary: 'x', args: {}, createdAt: new Date().toISOString(), status: 'pending',
    })
    expect((await first.claimPending('p1', 'claim-a'))?.status).toBe('executing')
    // A different provider instance sees the executing claim, so claim
    // liveness cannot come from this process's memory.
    expect((await second.listPending('executing')).map(row => row.id)).toEqual(['p1'])
  })

  it('refuses an invalid record at the write boundary and leaves the store readable', async () => {
    const { provider, home } = await providerAt()
    await expect(provider.savePending({
      id: 'p1', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'not-a-status',
    } as never)).rejects.toThrow(/invalid pending record/)
    expect(await provider.listPending('pending')).toEqual([])
    await provider.savePending({ id: 'p1', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'pending' })
    expect(existsSync(join(home, 'state', 'store.json'))).toBe(true)
  })

  it('rejects a corrupt store instead of treating it as empty', async () => {
    const home = await tempRoot('dsh-state-store-corrupt-')
    const io = nodeEvolutionIo()
    await io.writeText(join(home, 'state', 'store.json'), '{ not json')
    const provider = createStateStoreProvider({ io, home })
    await expect(provider.listPending()).rejects.toThrow(/not valid JSON/)
  })

  it('keeps the resolved pending tail bounded', async () => {
    const { provider } = await providerAt()
    for (let index = 0; index < 220; index += 1) {
      const id = 'cap-' + String(index)
      await provider.savePending({ id, kind: 'memory', summary: id, args: {}, createdAt: new Date().toISOString(), status: 'pending' })
      expect((await provider.tryResolvePending(id, 'rejected')).applied).toBe(true)
    }
    const rejected = await provider.listPending('rejected')
    expect(rejected.length).toBeLessThanOrEqual(200)
  })
})
