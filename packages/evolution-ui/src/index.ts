/**
 * Host umbrella for the evolution UI panels: one row mounts all four existing host halves.
 * The panel packages stay separate until their client code moves here.
 * @module @deepseek-ai/dsh-evolution-ui
 */
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyMerge } from '@deepseek-ai/dsh-evolution-merge-ui'
import { apply as applyHistory } from '@deepseek-ai/dsh-evolution-skill-history'

export const name = 'evolution-ui'
/** No required service: every nested row resolves its own optional seats. */
export const inject: string[] = []

/** Mount the four panel host halves through their existing owners. */
export function apply(ctx: Context): void {
  applyMerge()
  applyHistory(ctx)
}
