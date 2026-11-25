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
import { evolutionIoAdapter } from '../io.ts'
import type {} from '../io-registry.ts'
import type {} from './storage.ts'
import { createStateStoreProvider } from './store.ts'
import { createStateV2Provider } from './v2-provider.ts'
import { activatePendingStateV2 } from './migrate.ts'
import { liveHomeFence } from '../mutation-authority.ts'
import { StoreKernel } from '../store/store-kernel.ts'
import { createStoreService } from '../store/service.ts'
import { readStoreActivation } from './activation.ts'

export const name = 'evolution-state-store'
export const inject = ['evolutionStateStorage', 'evolutionIo']

export async function apply(ctx: Context): Promise<void> {
  await ctx.evolutionIo.whenReady()
  const home = evolutionHome()
  // Resolve the IO provider at every call: HMR may replace it, and the service,
  // kernel and v2 provider must not freeze the disposed backend.
  const io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
  // Promote a staged migration before any provider/bridge reads the marker:
  // the command deliberately does not activate a live host. This rebuilds the
  // head from the current legacy bytes and writes the active marker; a crash
  // between the two leaves the pending marker so the next start retries.
  await activatePendingStateV2(ctx, { io, home })
  // A fresh provider per apply: HMR may replace the IO provider, and a cached
  // provider would keep reading through the disposed one. The effect cleanup
  // unregisters this exact object before the next apply registers its own.
  const provider = createStateStoreProvider({ io, home })
  ctx.effect(() => ctx.evolutionStateStorage.registerProvider(provider), 'evolution-state-store.provider')
  // R2: the MVCC provider is registered but never auto-selected until the
  // explicit v2 marker exists. Its fence is resolved per use so HMR/late
  // authority provisioning cannot freeze a stale writer lock.
  // The unified surface service is created first: the state provider becomes
  // one of its consumers instead of opening a second kernel path.
  const activation = readStoreActivation(home)
  const service = activation?.mode === 'store-v2'
    ? createStoreService(new StoreKernel({ io, home, fence: liveHomeFence(ctx, home) }), activation.generation)
    : undefined
  const v2Provider = createStateV2Provider({
    io,
    home,
    fence: liveHomeFence(ctx, home),
    ...(service === undefined ? {} : { service }),
  })
  ctx.effect(() => ctx.evolutionStateStorage.registerProvider(v2Provider), 'evolution-state-store-v2.provider')
  if (service !== undefined) ctx.provide('evolutionStore', service)
}
