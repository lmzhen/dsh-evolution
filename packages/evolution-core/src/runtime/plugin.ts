/**
 * Runtime composition entry: mount the family's domain services once per
 * composition scope. Projection consumers read the service; they never
 * register units themselves.
 */
import type { Context } from '@deepseek-ai/cordis'
import { warnIfFamilyMixed } from './coherence.ts'
import { EvolutionLlm } from './llm.ts'
import { EvolutionPlatform } from './platform.ts'
import { EvolutionProjections } from './projections.ts'

export const name = 'evolution-core-runtime'

/** @param ctx - the composition context that owns the runtime services. */
export async function apply(ctx: Context): Promise<void> {
  // Ports resolve from the platform service now, so the platform must be mounted
  // before the consumers initialize; sequential plugin mounts make that order real.
  await ctx.plugin(EvolutionPlatform)
  await ctx.plugin(EvolutionProjections)
  await ctx.plugin(EvolutionLlm)
  warnIfFamilyMixed(ctx)
}
