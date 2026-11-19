/**
 * The curator subcommands: run / pause / resume / status / scope / report.
 * One function keeps their shared service lookup and error posture together.
 * @module evolution-commands/src/host-commands/curator-command
 */
import type { HostLocale } from '@deepseek-ai/dsh-evolution-core'
import type { CommandResult } from '@deepseek-ai/dsh-evolution-platform-contract'
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
  if (input === 'curator scope') {
    const curator = ctx.get('evolutionCurator') as { scopeView(): Promise<{ managed: string[]; watched: string[]; qualityWarned: string[]; exempted: string[]; protected: string[] }> } | undefined
    if (!curator) return err(hostError('e-302-curator-service-not-mounted'))
    const view = await curator.scopeView()
    const line = (label: string, names: string[]): string => `${label}: ${names.length}${names.length === 0 ? '' : `\n  ${names.join(', ')}`}`
    return ok([
      `Lifecycle scope at ${new Date().toISOString().slice(0, 10)}`,
      line('Managed (may transition)', view.managed),
      line('Watched (stale / quality-warned)', view.watched),
      line('Quality-warned', view.qualityWarned),
      line('Exempted (exclude / referenced)', view.exempted),
      line('Protected (pinned / bundled / hub / builtin)', view.protected),
    ].join('\n'))
  }
  if (input === 'curator report') {
    const curator = ctx.get('evolutionCurator') as { latestReport(): Promise<{ runId: string; startedAt: string; archived: Array<{ name: string }>; failed: Array<{ name: string; reason: string }>; aborted?: string; unattributed?: string[] } | null> } | undefined
    if (!curator) return err(hostError('e-302-curator-service-not-mounted'))
    const report: unknown = await curator.latestReport()
    if (!report) return ok(hostCommandText(locale, 'command.curator.noReport'))
    // V6-41 (0.3.36): the report file is out-of-band editable — a damaged
    // shape must render "report unreadable" instead of an uncaught
    // TypeError (the `curator status` command already has this posture).
    if (typeof report !== 'object'
      || typeof (report as { runId?: unknown }).runId !== 'string'
      || typeof (report as { startedAt?: unknown }).startedAt !== 'string'
      || !Array.isArray((report as { archived?: unknown }).archived)
      || !Array.isArray((report as { failed?: unknown }).failed)) {
      return err(hostCommandText(locale, 'command.curator.reportReadFailed'))
    }
    const reportAny = report as {
      runId: string
      startedAt: string
      archived: unknown[]
      failed: unknown[]
      // Out-of-band editable like every other field: read defensively.
      aborted?: unknown
      unattributed?: unknown
    }
    const nameOf = (item: unknown): string =>
      typeof item === 'object' && item !== null && typeof (item as { name?: unknown }).name === 'string'
        ? (item as { name: string }).name
        : '?'
    const reasonOf = (item: unknown): string =>
      typeof item === 'object' && item !== null && typeof (item as { reason?: unknown }).reason === 'string'
        ? (item as { reason: string }).reason
        : '?'
    // P2-16 (v38): an interrupted run reports failed=(none) and used to
    // read as a clean pass here, while the .md digest printed **Aborted**
    // (V27 CUR-2). Carry the same run-level facts on the command surface.
    const aborted = typeof reportAny.aborted === 'string' ? reportAny.aborted : undefined
    const unattributed = Array.isArray(reportAny.unattributed) ? reportAny.unattributed.length : 0
    const lines = [
      `runId=${reportAny.runId}`,
      `startedAt=${reportAny.startedAt}`,
      `archived=${reportAny.archived.map(nameOf).join(', ') || '(none)'}`,
      `failed=${reportAny.failed.map(item => `${nameOf(item)}: ${reasonOf(item)}`).join(', ') || '(none)'}`,
      ...aborted === undefined ? [] : [`aborted=${aborted}`],
      ...unattributed === 0 ? [] : [`unattributed=${unattributed}`],
    ]
    return ok(lines.join('\n'))
  }
  return undefined
}

/** The read-only mutations log (separate command id, same curator service). */
export async function runMutationsCommand(context: CuratorCommandContext): Promise<CommandResult | undefined> {
  const { input, ctx, locale } = context
  const hostError = (id: Parameters<typeof hostErrorText>[1], args: Record<string, string | number> = {}): string => hostErrorText(locale, id, args)
  if (input === 'mutations') {
    const curator = ctx.get('evolutionCurator') as { skills: { listMutations(): Promise<Array<{ at: string; skillName: string; action: string; summary: string }>> } } | undefined
    if (!curator) return err(hostError('e-302-curator-service-not-mounted'))
    const records: unknown = await curator.skills.listMutations()
    // V6-41 (0.3.36): the mutations file is out-of-band editable — a
    // damaged record must not crash the command with a TypeError (the
    // `curator status` command already has this posture).
    const usable = Array.isArray(records)
      ? records.filter((row): row is { at: string; skillName: string; action: string; summary: string } =>
        typeof row === 'object' && row !== null
        && typeof (row as { at?: unknown }).at === 'string'
        && typeof (row as { skillName?: unknown }).skillName === 'string'
        && typeof (row as { action?: unknown }).action === 'string'
        && typeof (row as { summary?: unknown }).summary === 'string')
      : []
    if (usable.length === 0) return ok('还没有写入记录。')
    const recent = usable.slice(-5).reverse().map(record => `${record.at.slice(0, 19)}  ${record.skillName}  ${record.action}  ${record.summary}`)
    return ok(`写入记录：已记录 ${usable.length} 条（最近 5 条）：\n${recent.join('\n')}`)
  }
  return undefined
}
