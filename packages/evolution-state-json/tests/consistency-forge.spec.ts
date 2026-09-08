import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EvolutionStateStorage } from '@deepseek-ai/dsh-evolution-state-storage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as JsonState from '../src/index.ts'
import { runStateProviderConsistency } from '../../test-support/state-provider-consistency.ts'

async function mount(root: string) {
  const ctx = new Context()
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(JsonState, { root })
  return ctx
}

/**
 * V4-07: the consistency base must actually catch a single forged field
 * difference, not merely pass for the real providers. These tests wrap a real
 * json provider and drop one field from a returned record, then assert the
 * harness rejects the broken provider.
 */
describe('state-provider-consistency catches forged field drift (V4-07)', () => {
  it('rejects a provider that drops summary on claim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-forge-sum-'))
    const ctx = await mount(root)
    const base = ctx.evolutionStateStorage.provider('json')
    const broken: EvolutionStateStorage = {
      ...base,
      claimPending: async (id, claimId) => {
        const record = await base.claimPending(id, claimId)
        if (record) record.summary = 'forged'
        return record
      },
    }
    await expect(runStateProviderConsistency(broken)).rejects.toThrow()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('rejects a provider that drops resolvedAt on resolve', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-forge-rat-'))
    const ctx = await mount(root)
    const base = ctx.evolutionStateStorage.provider('json')
    const broken: EvolutionStateStorage = {
      ...base,
      tryResolvePending: async (id, status) => {
        const result = await base.tryResolvePending(id, status)
        if (result.record) delete result.record.resolvedAt
        return result
      },
    }
    await expect(runStateProviderConsistency(broken)).rejects.toThrow()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})
