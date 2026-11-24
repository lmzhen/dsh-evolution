// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mountStateStack } from '../../../test-support/state-stack.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'
import * as StorePlugin from '../../src/state/store-plugin.ts'
import { STATE_V2_MIGRATION_MARKER } from '../../src/state/constants.ts'

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
})
