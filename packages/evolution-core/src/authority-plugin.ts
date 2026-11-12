import type { Context } from '@deepseek-ai/cordis'
import { evolutionHome } from './state-store.ts'
import { MutationAuthority } from './mutation-authority.ts'


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
