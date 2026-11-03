/**
 * Browser umbrella: one client bundle registers the settings and skill-history panel rows.
 * @module @deepseek-ai/dsh-evolution-ui/client
 */
import type { Context } from '@deepseek-ai/cordis'
import { apply as applySettings } from '../panels/settings/index.ts'
import { apply as applyHistory } from '../panels/history/client/index.ts'

export const inject = ['slots', 'locale', 'layout', 'settingsScope', 'connection']

/** Register every panel through the shared client-kit lifecycle. */
export function apply(ctx: Context): void {
  applySettings(ctx)
  applyHistory(ctx)
}
