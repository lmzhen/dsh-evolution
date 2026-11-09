import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as Authority from '../src/index.ts'

it('provides one evolutionMutationAuthority over the IO seam', async () => {
  const ctx = new Context()
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(Authority)
  expect(ctx.evolutionMutationAuthority).toBeDefined()
})
