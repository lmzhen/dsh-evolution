import { describe, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as JsonState from '../src/index.ts'
import { runStateProviderConsistency } from '../../test-support/state-provider-consistency.ts'

describe('evolution-state-json cross-provider consistency (G7.4)', () => {
  it('matches the shared provider contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-consistent-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root })
    await runStateProviderConsistency(ctx.evolutionStateStorage.provider('json'))
    await rm(root, { recursive: true, force: true })
  })
})
