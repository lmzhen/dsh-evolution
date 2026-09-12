import { describe, expect, it } from 'vitest'
import type { EvolutionStateStorage } from '@deepseek-ai/dsh-evolution-state-storage'
import { runStateProviderConsistency } from '../../test-support/state-provider-consistency.ts'
import { tempRoot } from '../../test-support/temp-home.ts'
import { mountStateStack } from '../../test-support/state-stack.ts'


/**
 * V4-07: the consistency base must actually catch a single forged field
 * difference, not merely pass for the real providers. These tests wrap a real
 * json provider and drop one field from a returned record, then assert the
 * harness rejects the broken provider.
 */
describe('state-provider-consistency catches forged field drift (V4-07)', () => {
  it('rejects a provider that drops summary on claim', async () => {
    const root = await tempRoot('dsh-json-forge-sum-')
    const ctx = await mountStateStack(root)
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
  })

  it('rejects a provider that drops resolvedAt on resolve', async () => {
    const root = await tempRoot('dsh-json-forge-rat-')
    const ctx = await mountStateStack(root)
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
  })
})
