// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mountStateStack } from '../../../test-support/state-stack.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'
import * as StorePlugin from '../../src/state/store-plugin.ts'
import { STATE_V2_MIGRATION_MARKER, STATE_V2_PENDING_MARKER } from '../../src/state/constants.ts'
import { writeStateStoreSnapshot } from '../../src/state/store.ts'
import { nodeEvolutionIo } from '../../src/io.ts'

describe('evolutionStore service provider', () => {
  it('is absent without the v2 marker', async () => {
    const root = await tempRoot('dsh-store-provider-off-')
    const ctx = await mountStateStack(root)
    const previous = process.env.DSH_EVOLUTION_HOME
    process.env.DSH_EVOLUTION_HOME = root
    try { await ctx.plugin(StorePlugin) } finally {
      if (previous === undefined) delete process.env.DSH_EVOLUTION_HOME
      else process.env.DSH_EVOLUTION_HOME = previous
    }
    expect(ctx.get('evolutionStore')).toBeUndefined()
  })

  it('promotes a staged v2 migration before providing the service', async () => {
    const root = await tempRoot('dsh-store-provider-pending-')
    await mkdir(join(root, 'state'), { recursive: true })
    await writeStateStoreSnapshot(
      nodeEvolutionIo(),
      join(root, 'state', 'store.json'),
      { review: { s1: { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 } }, curator: null, pending: {} },
    )
    await writeFile(join(root, 'state', STATE_V2_PENDING_MARKER), JSON.stringify({ target: 'store-v2', source: 'store' }) + '\n')
    // Writes that happen after the command staged the migration must be in the
    // promoted head: promotion reads the CURRENT legacy bytes.
    await rm(join(root, 'state', 'store.json'), { force: true })
    await writeStateStoreSnapshot(nodeEvolutionIo(), join(root, 'state', 'store.json'), {
      review: { s1: { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 }, post: { turnsSinceMemory: 9, turnsSinceSkill: 0, lastTurn: 9 } },
      curator: null,
      pending: {},
    })
    const ctx = await mountStateStack(root)
    const previous = process.env.DSH_EVOLUTION_HOME
    process.env.DSH_EVOLUTION_HOME = root
    try {
      await ctx.plugin(StorePlugin)
      const io = ctx.evolutionIo.provider()
      expect(await io.exists(join(root, 'store-v2', 'head.json'))).toBe(true)
      expect(await io.exists(join(root, 'state', STATE_V2_MIGRATION_MARKER))).toBe(true)
      expect(await io.exists(join(root, 'state', STATE_V2_PENDING_MARKER))).toBe(false)
      const store = ctx.get('evolutionStore') as { query(id: string, domains: readonly string[]): Promise<{ snapshot: { domains: { state?: { review?: Record<string, unknown> } } } }> }
      const state = (await store.query('state.provider', ['state'])).snapshot.domains.state
      expect(state?.review?.post).toMatchObject({ lastTurn: 9 })
    } finally {
      if (previous === undefined) delete process.env.DSH_EVOLUTION_HOME
      else process.env.DSH_EVOLUTION_HOME = previous
    }
  })

  it('is present after the v2 marker', async () => {
    const root = await tempRoot('dsh-store-provider-on-')
    await mkdir(join(root, 'state'), { recursive: true })
    await writeFile(join(root, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    const ctx = await mountStateStack(root)
    const previous = process.env.DSH_EVOLUTION_HOME
    process.env.DSH_EVOLUTION_HOME = root
    try { await ctx.plugin(StorePlugin) } finally {
      if (previous === undefined) delete process.env.DSH_EVOLUTION_HOME
      else process.env.DSH_EVOLUTION_HOME = previous
    }
    expect(ctx.get('evolutionStore')).toBeDefined()
  })

  it('re-provides the service after a plugin reload', async () => {
    const root = await tempRoot('dsh-store-provider-hmr-')
    await mkdir(join(root, 'state'), { recursive: true })
    await writeFile(join(root, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    const ctx = await mountStateStack(root)
    const previous = process.env.DSH_EVOLUTION_HOME
    process.env.DSH_EVOLUTION_HOME = root
    try {
      const first = await ctx.plugin(StorePlugin) as unknown as { dispose(): Promise<void> }
      expect(ctx.get('evolutionStore')).toBeDefined()
      await first.dispose()
      await ctx.plugin(StorePlugin)
      expect(ctx.get('evolutionStore')).toBeDefined()
    } finally {
      if (previous === undefined) delete process.env.DSH_EVOLUTION_HOME
      else process.env.DSH_EVOLUTION_HOME = previous
    }
  })
})
