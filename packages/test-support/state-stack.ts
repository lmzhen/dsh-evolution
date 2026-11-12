/**
 * Mount the state-backed plugin stack the state/approval suites repeat per test.
 *
 * The stack is always mounted per test (never hoisted: the suites pin their own
 * projection/storage wiring), so the only shared part is the order and the
 * arguments — the options select how far up the stack a test needs to go.
 *
 * The state medium is the platform storage stack (hub + json backend + KV domain)
 * with the family's domain provider on top; the family no longer owns a file medium.
 */
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Storage, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import * as DomainFacility from '@deepseek-ai/dsh-storage-domain'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state/storage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-core/io-registry'
import * as NodeIo from '@deepseek-ai/dsh-evolution-core/io-node'
import { MutationAuthority } from '@deepseek-ai/dsh-evolution-core'
import EvolutionState from '@deepseek-ai/dsh-evolution-state'
import * as DomainState from '@deepseek-ai/dsh-evolution-state-domain'
import EvolutionApproval from '@deepseek-ai/dsh-evolution-approval'

/**
 * Build a fresh Context carrying the state stack rooted at `root`.
 * @param root - evolution home; the KV medium lives under `root/storage`.
 * @param options - `evolution` adds the state facade, `approval` the approval service.
 * @returns the mounted context.
 */
export async function mountStateStack(
  root: string,
  options: { evolution?: boolean; approval?: boolean; authority?: boolean } = {},
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(join(root, 'storage'))
  ctx.storage.backend.register('test-json', backend)
  ctx.provide(storageBackendServiceKey('test-json'), backend)
  await ctx.plugin(DomainFacility, { backend: 'test-json' })
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  if (options.authority === true) ctx.provide('evolutionMutationAuthority', new MutationAuthority({ io: ctx.evolutionIo.provider(), home: root }))
  await ctx.plugin(DomainState)
  if (options.evolution) await ctx.plugin(EvolutionState, { provider: 'domain' })
  if (options.approval) await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
  return ctx
}
