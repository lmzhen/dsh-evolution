import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as JsonState from '../src/index.ts'
import { runStateProviderConsistency } from '@deepseek-ai/dsh-evolution-state-storage'
import { tempRoot } from '../../test-support/temp-home.ts'

describe('evolution-state-json cross-provider consistency (G7.4)', () => {
  // E9: 45.9s alone against a 180s budget is a ~4x margin, and a loaded machine crossed it (the same
  // gate run showed tsc at 281s against its usual 34s). The budget guards against a HANG, it is not a
  // performance assertion, so it moves; the assertions do not.
  it('matches the shared provider contract', { timeout: 300_000 }, async () => {
    const root = await tempRoot('dsh-json-consistent-')
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root })
    await runStateProviderConsistency(ctx.evolutionStateStorage.provider('json'), expect)
  })

  // U-2: the suite is PARAMETERIZABLE — a provider whose medium already holds records in the default
  // namespace (or whose schema insists on a parseable stamp) runs the same vectors under its own.
  it('runs the same vectors under a caller-supplied namespace and stamp', { timeout: 300_000 }, async () => {
    const root = await tempRoot('dsh-json-consistent-u2-')
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root })
    await runStateProviderConsistency(ctx.evolutionStateStorage.provider('json'), expect, {
      idPrefix: 'u2-',
      claimPrefix: 'u2-claim-',
      createdAt: new Date().toISOString(),
      sessionId: 'u2-session',
      attributionSessionId: 'u2-attrib-session',
      reviewSessionPrefix: 'u2-cap-',
    })
  })
})
