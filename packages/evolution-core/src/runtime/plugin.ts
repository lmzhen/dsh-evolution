/**
 * Runtime composition entry: mount the family's domain services once per
 * composition scope. Projection consumers read the service; they never
 * register units themselves.
 */
import type { Context } from '@deepseek-ai/cordis'
import { EvolutionLlm } from './llm.ts'
import { EvolutionProjections } from './projections.ts'

export const name = 'evolution-core-runtime'

/** @param ctx - the composition context that owns the runtime services. */
export function apply(ctx: Context): void {
  ctx.plugin(EvolutionProjections)
  ctx.plugin(EvolutionLlm)
}
