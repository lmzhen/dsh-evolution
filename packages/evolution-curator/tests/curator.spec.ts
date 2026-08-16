import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '../src/index.ts'

describe('evolution-curator', () => {
  it('starts stopped by default and can run manually', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator, { enabled: true, intervalHours: 24 })
    ctx.evolutionCurator.start()
    const result = await ctx.evolutionCurator.run()
    expect(Array.isArray(result.stale)).toBe(true)
    expect(Array.isArray(result.archived)).toBe(true)
    ctx.evolutionCurator.stop()
  })
})
