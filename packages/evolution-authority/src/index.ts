import type { Context } from '@deepseek-ai/cordis'
import { evolutionHome, MutationAuthority } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-io'

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionMutationAuthority: MutationAuthority
  }
}

export const name = 'evolution-authority'
export const inject = ['evolutionIo']

/** Expose the single home/run-fenced mutation authority to domain packages. */
export function apply(ctx: Context): void {
  const authority = new MutationAuthority({ io: ctx.evolutionIo.provider(), home: evolutionHome() })
  ctx.provide('evolutionMutationAuthority', authority)
}
