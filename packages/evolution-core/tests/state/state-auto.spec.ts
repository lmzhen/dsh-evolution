// @tier fast
import { afterAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mountStateStack } from '../../../test-support/state-stack.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'
import EvolutionState from '../../src/state/index.ts'
import * as StorePlugin from '../../src/state/store-plugin.ts'
import { STATE_MIGRATION_MARKER } from '../../src/state/constants.ts'

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
    await ctx.plugin(EvolutionState, { provider: 'auto' })
    const domain = ctx.evolutionStateStorage.provider('domain')
    await domain.saveCuratorState({ lastRunAt: 1, runCount: 2, lastSummary: 'on-domain', paused: false })
    expect(await ctx.evolutionState.loadCuratorState()).toMatchObject({ lastSummary: 'on-domain' })
    // The marker is the explicit switch: with no store data the same call now
    // reads the file authority (empty), proving the domain is no longer selected.
    await ctx.evolutionIo.provider().writeText(join(evolution, 'state', STATE_MIGRATION_MARKER), '{}\n')
    expect(await ctx.evolutionState.loadCuratorState()).toBeNull()
  })
})
