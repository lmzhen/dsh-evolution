/**
 * The curator subcommands: run / pause / resume / status / scope / report.
 * One function keeps their shared service lookup and error posture together.
 * @module evolution-commands/src/host-commands/curator-command
 */
import type { HostLocale } from '@deepseek-ai/dsh-evolution-core'
import type { CommandResult } from '@deepseek-ai/dsh-evolution-core/platform'
import { hostCommandText, hostErrorText } from '../host-locale.ts'

/** What the curator handler needs from the command body. */
export interface CuratorCommandContext {
  readonly input: string
  readonly ctx: { get(name: string): unknown }
  readonly locale: HostLocale
}

const ok = (text: string): CommandResult => ({ kind: 'success', text })
const err = (text: string): CommandResult => ({ kind: 'error', text })

/**
 * Run one curator subcommand. Returns undefined when the input is not a curator command,
 * so the legacy chain can answer.
 * @param context - raw input, service context and locale.
 * @returns the command result or undefined.
 */
export async function runCuratorCommand(context: CuratorCommandContext): Promise<CommandResult | undefined> {
  const { input, ctx, locale } = context
  const hostError = (id: Parameters<typeof hostErrorText>[1], args: Record<string, string | number> = {}): string => hostErrorText(locale, id, args)
  if (input === 'curator run') {
    const curator = ctx.get('evolutionCurator') as { run(options?: { ignoreGates?: boolean }): Promise<{ stale: string[]; archived: string[]; errors: string[]; skipped?: string; report: { runId: string; snapshotPath?: string } }> } | undefined
    if (!curator) return err(hostError('e-302-curator-service-not-mounted'))
    const result = await curator.run({ ignoreGates: true })
    // D-12 (v18): a reentrant run that was skipped must not be reported
    // as a completed 0/0/0 pass.
    if (result.skipped !== undefined) {
      return ok(hostCommandText(locale, 'command.curator.skipped', { reason: result.skipped, runId: result.report.runId }))
    }
    return ok(hostCommandText(locale, 'command.curator.done', { stale: result.stale.length, archived: result.archived.length, errors: result.errors.length, runId: result.report.runId, snapshot: result.report.snapshotPath ? `\nsnapshot=${result.report.snapshotPath}` : '' }))
  }
  if (input === 'curator pause' || input === 'curator resume') {
    const curator = ctx.get('evolutionCurator') as { setPaused(paused: boolean): Promise<void> } | undefined
    if (!curator) return err(hostError('e-302-curator-service-not-mounted'))
    const paused = input === 'curator pause'
    await curator.setPaused(paused)
    // H-07 completion: in a state-less composition the curator warns and
    // DROPS the write (setPaused is `Promise<void>`, so the loss cannot
    // travel through the return). Surface it on the command result so
    // the operator can tell a persisted pause from an ephemeral one.
    const stateMounted = ctx.get('evolutionState') !== undefined
    const notPersisted = stateMounted ? '' : hostCommandText(locale, 'command.curator.notPersisted')
    return ok((paused
      ? hostCommandText(locale, 'command.curator.paused')
      : hostCommandText(locale, 'command.curator.resumed')) + notPersisted)
  }
  if (input === 'curator status') {
    const curator = ctx.get('evolutionCurator') as { status(): Promise<{ lastRunAt: number; runCount: number; lastSummary: string; paused: boolean } | null> } | undefined
    if (!curator) return err(hostError('e-302-curator-service-not-mounted'))
    const state = await curator.status()
    if (!state) return ok(hostCommandText(locale, 'command.curator.noState'))
    // A corrupt state record must not crash the command surface with a
    // RangeError from `Invalid Date`.toISOString().
    const lastRun = typeof state.lastRunAt === 'number' && Number.isFinite(state.lastRunAt) && state.lastRunAt > 0
      ? new Date(state.lastRunAt).toISOString()
      : 'unknown'
    return ok([
      `paused=${state.paused}`,
      `runs=${state.runCount}`,
      `lastRun=${lastRun}`,
      `summary=${state.lastSummary}`,
    ].join('\n'))
  }
  return undefined
}
