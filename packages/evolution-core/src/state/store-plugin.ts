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
import { createStateV2Provider } from './v2-provider.ts'
import { liveHomeFence } from '../mutation-authority.ts'

export const name = 'evolution-state-store'
export const inject = ['evolutionStateStorage', 'evolutionIo']

export async function apply(ctx: Context): Promise<void> {
  await ctx.evolutionIo.whenReady()
  const home = evolutionHome()
  // A fresh provider per apply: HMR may replace the IO provider, and a cached
  // provider would keep reading through the disposed one. The effect cleanup
  // unregisters this exact object before the next apply registers its own.
  const provider = createStateStoreProvider({ io: ctx.evolutionIo.provider(), home })
  ctx.effect(() => ctx.evolutionStateStorage.registerProvider(provider), 'evolution-state-store.provider')
  // R2: the MVCC provider is registered but never auto-selected until the
  // explicit v2 marker exists. Its fence is resolved per use so HMR/late
  // authority provisioning cannot freeze a stale writer lock.
  const v2Provider = createStateV2Provider({
    io: ctx.evolutionIo.provider(),
    home,
    fence: liveHomeFence(ctx, home),
  })
  ctx.effect(() => ctx.evolutionStateStorage.registerProvider(v2Provider), 'evolution-state-store-v2.provider')
}
