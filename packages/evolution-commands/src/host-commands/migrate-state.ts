/**
 * `/evolution migrate state [--dry-run]`.
 *
 * The one explicit data-migration entry point: it reads the mounted domain provider
 * (or opens the domain when the row is not mounted yet), writes a complete file
 * StateStore snapshot, and never deletes the old data. The host owner decides when
 * to switch `evolution-state.provider` to `store`.
 * @module evolution-commands/src/host-commands/migrate-state
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-evolution-platform/contract'
import { evolutionHome } from '@deepseek-ai/dsh-evolution-core'
import { migrateDomainToStore, migrateStateToV2 } from '@deepseek-ai/dsh-evolution-core/state/migrate'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { join } from 'node:path'
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
  // The platform parser keeps `state` as a positional even though the def lists
  // both words; accept that form and reject any extra word.
  const positionals = context.command.positionals
  if (positionals.length > 1 || (positionals.length === 1 && positionals[0] !== 'state')) {
    return err(hostCommandText(context.locale, 'help.migrate state'))
  }
  const dryRun = context.command.flags.get('dry-run') === true
  const to = context.command.flags.get('to')
  if (to !== undefined && to !== 'v2') {
    return err(hostCommandText(context.locale, 'help.migrate state'))
  }
  // The command handler context is a restricted child: a bare `ctx.get` does
  // not grant the services. Inject first, then migrate on the scoped context.
  return new Promise<CommandResult>(resolve => {
    ;(context.ctx as unknown as Context).inject(['evolutionIo', 'evolutionStateStorage', 'evolutionState'], (scoped) => {
      void (async (): Promise<void> => {
        try {
          const io = (scoped as unknown as { evolutionIo: { provider(): EvolutionIoLike } }).evolutionIo.provider()
          const valueFlag = (name: string): string | undefined => {
            const value = context.command.flags.get(name)
            return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
          }
          const skillsRoot = valueFlag('skills-root')
          const memoryRoot = valueFlag('memory-root')
          const discoveryRoot = valueFlag('discovery-root')
          const feedbackPath = valueFlag('feedback-path')
          const discoveryPaths = discoveryRoot === undefined ? undefined : {
            domainMap: join(discoveryRoot, 'domain-map.json'),
            projectionJournal: join(discoveryRoot, 'projection-journal.json'),
            viewSnapshots: join(discoveryRoot, 'view-snapshots.json'),
          }
          const result = to === 'v2'
            ? await migrateStateToV2(scoped, {
              io,
              home: evolutionHome(),
              dryRun,
              stage: true,
              ...(skillsRoot === undefined ? {} : { skillsRoot }),
              ...(memoryRoot === undefined ? {} : { memoryRoot }),
              ...(discoveryPaths === undefined ? {} : { discoveryPaths }),
              ...(feedbackPath === undefined ? {} : { feedbackPath }),
            })
            : await migrateDomainToStore(scoped, { io, home: evolutionHome(), dryRun })
          const values = { review: result.reviewSessions, pending: result.pending, curator: result.curator ? 'yes' : 'no', path: result.path }
          const staged = to === 'v2' && !dryRun && 'commitId' in result && result.commitId === ''
          let text = hostCommandText(context.locale, staged
            ? 'command.migrate state.staged'
            : dryRun ? 'command.migrate state.dry' : 'command.migrate state.done', values)
          const selection = (scoped as unknown as { evolutionState?: { providerSelection?: () => { configured: string; effective: string } } }).evolutionState?.providerSelection?.()
          if (!staged && selection?.effective === 'domain') text += '\n' + hostCommandText(context.locale, 'command.migrate state.pin')
          resolve(ok(text))
        } catch (error) {
          resolve(err(hostCommandText(context.locale, 'command.migrate state.error', {
            message: error instanceof Error ? error.message : String(error),
          })))
        }
      })()
    })
  })
}
