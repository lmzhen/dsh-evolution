import { describe, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Storage, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import * as DomainFacility from '@deepseek-ai/dsh-storage-domain'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as DomainState from '../src/index.ts'
import { runStateProviderConsistency } from '../../test-support/state-provider-consistency.ts'

async function mount(home: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('test-json', new JsonStorageBackend(home))
  ctx.provide(storageBackendServiceKey('test-json'), new JsonStorageBackend(home))
  await ctx.plugin(DomainFacility, { backend: 'test-json' })
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(DomainState)
  return ctx
}

describe('evolution-state-domain cross-provider consistency (G7.4)', () => {
  it('matches the shared provider contract', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-consistent-'))
    const ctx = await mount(home)
    await runStateProviderConsistency(ctx.evolutionStateStorage.provider('domain'))
    await rm(home, { recursive: true, force: true })
  })
})
