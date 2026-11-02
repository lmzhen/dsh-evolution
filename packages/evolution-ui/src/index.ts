/**
 * Host umbrella for the evolution UI panels: one row mounts the settings and skill-history host halves.
 * The panel packages stay separate until their client code moves here.
 * @module @deepseek-ai/dsh-evolution-ui
 */
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyHistory } from './panels/history/host.ts'

export const name = 'evolution-ui'
/** No required service: every nested row resolves its own optional seats. */
export const inject: string[] = []

/** Mount the four panel host halves through their existing owners. */
export function apply(ctx: Context): void {
  applyHistory(ctx)
}
