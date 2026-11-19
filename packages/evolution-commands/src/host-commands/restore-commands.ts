/** The two whole/single-tree restore commands, both behind the same replayability refusal. */
import type { EvolutionErrorId, HostLocale } from '@deepseek-ai/dsh-evolution-core'
import type { CommandResult } from '@deepseek-ai/dsh-evolution-platform-contract'
import { hostErrorText } from '../host-locale.ts'

/** What the restore handlers need. */
export interface RestoreCommandContext {
  readonly input: string
  readonly ctx: { get(name: string): unknown }
  readonly locale: HostLocale
  readonly refusal: (what: string) => CommandResult | undefined
}

const ok = (text: string): CommandResult => ({ kind: 'success', text })
const err = (text: string): CommandResult => ({ kind: 'error', text })
const hostError = (locale: HostLocale, id: EvolutionErrorId, args: Record<string, string | number> = {}): string => hostErrorText(locale, id, args)

/** The whole-tree restore. A tail is refused so a missing `skill ` prefix cannot roll back everything. */
export async function runRestoreCommand(context: RestoreCommandContext): Promise<CommandResult | undefined> {
  const { input, ctx, locale, refusal } = context
  if (input !== 'restore' && !input.startsWith('restore ')) return undefined
  const tail = input.slice('restore'.length).trim()
  if (tail !== '') return err(`\`restore\` 不接受参数（收到 "${tail}"）。\`restore\` 做整树回滚，\`skill restore <name>\` 恢复单个技能。`)
  const blocked = refusal('restore')
  if (blocked !== undefined) return blocked
  const curator = ctx.get('evolutionCurator') as { restoreSnapshot(): Promise<{ ok: boolean; message: string }> } | undefined
  if (curator === undefined) return err(hostError(locale, 'e-302-curator-service-not-mounted'))
  const outcome = await curator.restoreSnapshot()
  return outcome.ok ? ok(outcome.message) : err(outcome.message)
}

/** One skill restore. */
export async function runSkillRestoreCommand(context: RestoreCommandContext): Promise<CommandResult | undefined> {
  const { input, ctx, locale, refusal } = context
  if (!input.startsWith('skill restore ')) return undefined
  const name = input.slice(14).trim()
  if (!name) return err('用法：/evolution skill restore <name>')
  const blocked = refusal('skill restore')
  if (blocked !== undefined) return blocked
  const curator = ctx.get('evolutionCurator') as { restore(name: string): Promise<{ ok: boolean; message: string }> } | undefined
  if (curator === undefined) return err(hostError(locale, 'e-302-curator-service-not-mounted'))
  const result = await curator.restore(name)
  return result.ok ? ok(result.message) : err(result.message)
}
