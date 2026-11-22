/**
 * Cordis row for the file StateStore provider.
 *
 * The provider is registered but not selected until `EvolutionState` sees the
 * migration marker (or is pinned to `store`). This lets `/evolution migrate state`
 * publish the snapshot while the host is still running on the old domain, then
 * the next restart selects the store without a second command.
 * @module @deepseek-ai/dsh-evolution-core/state/store-plugin
 */
import type { Context } from '@deepseek-ai/cordis'
import { evolutionHome } from '../state-store.ts'
import type {} from '../io-registry.ts'
import type {} from './storage.ts'
import { createStateStoreProvider } from './store.ts'

export const name = 'evolution-state-store'
export const inject = ['evolutionStateStorage', 'evolutionIo']

/** HMR re-applies the row in the same ctx; the registry only treats the SAME object as
 * idempotent, so keep one provider per home instead of constructing a new registrant. */
const providers = new Map<string, ReturnType<typeof createStateStoreProvider>>()

export async function apply(ctx: Context): Promise<void> {
  await ctx.evolutionIo.whenReady()
  const home = evolutionHome()
  let provider = providers.get(home)
  if (provider === undefined) {
    provider = createStateStoreProvider({ io: ctx.evolutionIo.provider(), home })
    providers.set(home, provider)
  }
  ctx.effect(() => ctx.evolutionStateStorage.registerProvider(provider), 'evolution-state-store.provider')
}
