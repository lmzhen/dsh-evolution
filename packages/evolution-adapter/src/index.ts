/**
 * Full adapter entry.
 *
 * - `./ports` is the composition-safe port surface.
 * - `./values` carries host-provided runtime helper values.
 * - `./service` is the Cordis `evolutionPlatform` service.
 *
 * Feature packages should use the narrow entries (`./ports`, `./values`) and
 * not this umbrella unless they need the service.
 */
import type { Context } from '@deepseek-ai/cordis'
import { EvolutionPlatform } from './service.ts'

export * from './ports.ts'
export * from './values.ts'
export * from './service.ts'

export const name = 'evolution-adapter'

/** Mount the one host platform service; bundle row order places this before core/runtime. */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(EvolutionPlatform)
}

