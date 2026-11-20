import type { Context } from '@deepseek-ai/cordis'
import { evolutionHome } from './state-store.ts'
import { MutationAuthority } from './mutation-authority.ts'


declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionMutationAuthority: MutationAuthority
  }
}

/** Deployment opt-in: use per-target cross-process locks for keyed skill writes. */
export interface Config {
  readonly keyedSkillLocks?: boolean
}

export const name = 'evolution-authority'
export const inject = ['evolutionIo']

/** Expose the single home/run-fenced mutation authority to domain packages. */
export function apply(ctx: Context, config: Config = {}): void {
  const authority = new MutationAuthority({
    io: ctx.evolutionIo.provider(),
    home: evolutionHome(),
    keyed: config.keyedSkillLocks === true,
  })
  ctx.provide('evolutionMutationAuthority', authority)
}
