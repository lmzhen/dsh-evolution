// @tier fast
import { afterAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mountStateStack } from '../../../test-support/state-stack.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'
import EvolutionState from '../../src/state/index.ts'
import * as StorePlugin from '../../src/state/store-plugin.ts'
import { STATE_MIGRATION_MARKER } from '../../src/state/constants.ts'
import { writeStateStoreSnapshot } from '../../src/state/store.ts'

const previousDshHome = process.env.DSH_HOME
afterAll(() => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
})

describe('state provider auto', () => {
  it('uses domain before the migration marker and store after it', async () => {
    const root = await tempRoot('dsh-state-auto-')
    const evolution = join(root, 'evolution')
    process.env.DSH_HOME = root
    const ctx = await mountStateStack(evolution)
    await ctx.plugin(StorePlugin)
    await ctx.plugin(EvolutionState, { provider: 'auto', home: evolution })
    const domain = ctx.evolutionStateStorage.provider('domain')
    await domain.saveCuratorState({ lastRunAt: 1, runCount: 2, lastSummary: 'on-domain', paused: false })
    expect(await ctx.evolutionState.loadCuratorState()).toMatchObject({ lastSummary: 'on-domain' })
    // The marker is the explicit switch; a non-empty store image is required, so
    // a half-migration cannot silently serve an empty authority.
    await writeStateStoreSnapshot(ctx.evolutionIo.provider(), join(evolution, 'state', 'store.json'), { review: {}, curator: null, pending: {} })
    await ctx.evolutionIo.provider().writeText(join(evolution, 'state', STATE_MIGRATION_MARKER), JSON.stringify({ target: 'store' }))
    expect(await ctx.evolutionState.loadCuratorState()).toBeNull()
  })

  it('mounts before the store provider and validates on the first operation', async () => {
    const root = await tempRoot('dsh-state-auto-order-')
    const evolution = join(root, 'evolution')
    process.env.DSH_HOME = root
    const ctx = await mountStateStack(evolution)
    await writeStateStoreSnapshot(ctx.evolutionIo.provider(), join(evolution, 'state', 'store.json'), { review: {}, curator: null, pending: {} })
    await ctx.evolutionIo.provider().writeText(join(evolution, 'state', STATE_MIGRATION_MARKER), JSON.stringify({ target: 'store' }))
    // The state row mounts before the store provider row; it must not throw here.
    await ctx.plugin(EvolutionState, { provider: 'auto', home: evolution })
    await ctx.plugin(StorePlugin)
    expect(await ctx.evolutionState.loadCuratorState()).toBeNull()
  })

  it('fails loud when the marker exists but the store is missing', async () => {
    const root = await tempRoot('dsh-state-auto-half-')
    const evolution = join(root, 'evolution')
    process.env.DSH_HOME = root
    const ctx = await mountStateStack(evolution)
    await ctx.plugin(StorePlugin)
    await ctx.plugin(EvolutionState, { provider: 'auto', home: evolution })
    await ctx.evolutionIo.provider().writeText(join(evolution, 'state', STATE_MIGRATION_MARKER), JSON.stringify({ target: 'store' }))
    expect(() => ctx.evolutionState.loadCuratorState()).toThrow(/unreadable|missing|invalid/)
    await ctx.evolutionIo.provider().writeText(join(evolution, 'state', 'store.json'), '   \n')
    expect(() => ctx.evolutionState.loadCuratorState()).toThrow(/unreadable|invalid/)
  })
})
