/**
 * `/evolution migrate state [--dry-run]`.
 *
 * The one explicit data-migration entry point: it reads the mounted domain provider
 * (or opens the domain when the row is not mounted yet), writes a complete file
 * StateStore snapshot, and never deletes the old data. The host owner decides when
 * to switch `evolution-state.provider` to `store`.
 * @module evolution-commands/src/host-commands/migrate-state
 */
import type { CommandResult } from '@deepseek-ai/dsh-evolution-platform/contract'
import { evolutionHome } from '@deepseek-ai/dsh-evolution-core'
import { migrateDomainToStore } from '@deepseek-ai/dsh-evolution-core/state/migrate'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { hostCommandText } from '../host-locale.ts'
import type { HostLocale } from '@deepseek-ai/dsh-evolution-core'

export interface MigrateStateContext {
  readonly input: string
  readonly command: { readonly flags: ReadonlyMap<string, string | boolean>; readonly positionals: readonly string[] }
  readonly ctx: { get(name: string): unknown } | undefined
  readonly locale: HostLocale
}

const ok = (text: string): CommandResult => ({ kind: 'success', text })
const err = (text: string): CommandResult => ({ kind: 'error', text })

export function runMigrateStateCommand(context: MigrateStateContext): CommandResult | Promise<CommandResult> {
  if (context.ctx === undefined) return err(hostCommandText(context.locale, 'command.migrate state.error', { message: 'command context unavailable' }))
  // The command's words already matched `migrate state`; a third word is a typo.
  if (context.command.positionals.length > 0) {
    return err(hostCommandText(context.locale, 'help.migrate state'))
  }
  const dryRun = context.command.flags.get('dry-run') === true
  const registry = (context.ctx as unknown as {
    evolutionIo?: { provider(name?: string): EvolutionIoLike | undefined } | undefined
  }).evolutionIo
  const io = registry?.provider?.()
  if (io === undefined) {
    return err(hostCommandText(context.locale, 'command.migrate state.error', { message: 'evolutionIo provider is not mounted' }))
  }
  return (async (): Promise<CommandResult> => {
    try {
      const result = await migrateDomainToStore(context.ctx as never, { io, home: evolutionHome(), dryRun })
      const values = { review: result.reviewSessions, pending: result.pending, curator: result.curator ? 'yes' : 'no', path: result.path }
      return ok(hostCommandText(context.locale, dryRun ? 'command.migrate state.dry' : 'command.migrate state.done', values))
    } catch (error) {
      return err(hostCommandText(context.locale, 'command.migrate state.error', {
        message: error instanceof Error ? error.message : String(error),
      }))
    }
  })()
}
