/**
 * The approval-facing commands: the pending window and the three decisions.
 * They share one context; the parser and the handler table stay in index.ts until D3 moves them.
 * @module evolution-commands/src/host-commands/approval-commands
 */
import type { ApprovalLike } from '@deepseek-ai/dsh-evolution-approval'
import type { CommandResult } from '@deepseek-ai/dsh-evolution-platform/contract'
import type { EvolutionErrorId, HostLocale } from '@deepseek-ai/dsh-evolution-core'
import { elapsedSince } from '@deepseek-ai/dsh-evolution-core/skills'
import { hostCommandText, hostErrorText } from '../host-locale.ts'
import type { ParsedCommand } from '../parse.ts'

/** What the approval handlers need from the command body. */
export interface ApprovalCommandContext {
  readonly command: ParsedCommand
  readonly approval: ApprovalLike | undefined
  readonly locale: HostLocale
}

const ok = (text: string): CommandResult => ({ kind: 'success', text })
const err = (text: string): CommandResult => ({ kind: 'error', text })
const hostError = (locale: HostLocale, id: EvolutionErrorId, args: Record<string, string | number> = {}): string =>
  hostErrorText(locale, id, args)

/** Render a staged args payload without ever letting the pending surface crash. */
function safeStagedArgs(args: unknown): string {
  try {
    const json = JSON.stringify(args)
    if (typeof json !== 'string') return '(unserializable)'
    if (json.length > 500) return `${json.slice(0, 500)}…(truncated ${json.length - 500} chars)`
    return json
  } catch {
    return '(unserializable)'
  }
}

/**
 * The pending window, including the executing rows and the TTL note.
 * @param context - approval service, command shape and locale.
 * @returns the rendered window or the service error.
 */
export async function runPendingCommand(context: ApprovalCommandContext): Promise<CommandResult> {
  const { approval, command, locale } = context
  if (!approval) return err(hostError(locale, 'e-301-approval-service-not-mounted'))
  const listed = [...await approval.list('pending'), ...await approval.list('executing')]
  const pending = [...new Map(listed.map(row => [row.id, row])).values()]
  const ttlMs = typeof approval.ttlMs === 'number' && Number.isFinite(approval.ttlMs) ? approval.ttlMs : 0
  const ttlNote = ttlMs > 0
    ? hostCommandText(locale, 'command.pending.ttl', { ttl: ttlMs })
    : hostCommandText(locale, 'command.pending.neverExpires')
  if (pending.length === 0) return ok(hostCommandText(locale, 'command.pending.empty') + ttlNote)
  const detailed = command.flags.get('detail') === true
  const nowMs = Date.now()
  const attribution = (p: { createdAt: string; origin?: string | undefined; sessionId?: string | undefined }): string => {
    const age = elapsedSince(p.createdAt, nowMs)
    const unit = age.n === 1 ? age.unit.replace(/s$/u, '') : age.unit
    const when = age.unit === 'now' ? hostCommandText(locale, 'command.pending.justNow') : hostCommandText(locale, 'command.pending.ago', { n: age.n, unit })
    const who = p.origin === undefined ? '' : hostCommandText(locale, 'command.pending.from', { origin: p.origin })
    const session = p.sessionId === undefined ? '' : hostCommandText(locale, 'command.pending.session', { session: p.sessionId.slice(0, 8) })
    return `  ·  ${when}${who}${session}`
  }
  const body = pending.map((p) => {
    if (!detailed) return `${p.id}  ${p.kind}  ${p.status === 'executing' ? hostCommandText(locale, 'command.pending.executing') + ' ' : ''}${p.summary}${attribution(p)}`
    const status = p.status === 'executing' ? hostCommandText(locale, 'command.pending.executing') : p.status
    const line = `${p.id}  ${p.kind}  ${status}  ${p.summary}${attribution(p)}`
    return p.args === undefined ? line : `${line}\n` + hostCommandText(locale, 'command.pending.stagedArgs', { args: safeStagedArgs(p.args) })
  }).join('\n')
  const hint = pending.some(p => p.status === 'executing')
    ? hostCommandText(locale, 'command.pending.executingHint')
    : ''
  return ok(body + hint + ttlNote)
}

/**
 * One decision verb: approve, reject or release, with the service-unavailable posture of each.
 * @param verb - the decision.
 * @param id - the staged record id.
 * @param context - approval service and locale.
 * @returns the service message as success or error.
 */
export async function runDecisionCommand(
  verb: 'approve' | 'reject' | 'release',
  id: string,
  context: ApprovalCommandContext,
): Promise<CommandResult> {
  const { approval, locale } = context
  if (!approval) return err(hostError(locale, 'e-301-approval-service-not-mounted-2'))
  if (verb === 'release') {
    if (!approval.release) return err(hostError(locale, 'e-304-the-mounted-approval-service'))
    const result = await approval.release(id)
    return result.ok ? ok(result.message) : err(result.message)
  }
  const result = await approval[verb](id)
  return result.ok ? ok(result.message) : err(result.message)
}
