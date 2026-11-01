/**
 * Browser umbrella: one client bundle registers the four existing panel rows.
 * @module @deepseek-ai/dsh-evolution-ui/client
 */
import type { Context } from '@deepseek-ai/cordis'
import { apply as applySettings } from '@deepseek-ai/dsh-evolution-settings-ui/client'
import { apply as applyMerge } from '@deepseek-ai/dsh-evolution-merge-ui/client'
import { apply as applyHistory } from '@deepseek-ai/dsh-evolution-skill-history/client'

export const inject = ['slots', 'locale', 'layout']

/** Register every panel through the shared client-kit lifecycle. */
export function apply(ctx: Context): void {
  applySettings(ctx)
  applyMerge(ctx)
  applyHistory(ctx)
}
