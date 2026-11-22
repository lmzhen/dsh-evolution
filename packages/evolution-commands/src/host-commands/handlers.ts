/** Extracted command handlers; the legacy chain answers whatever is not here. */
import type { CommandResult } from '@deepseek-ai/dsh-evolution-platform/contract'
import type { SettingsProviderLike } from '@deepseek-ai/dsh-evolution-core'
import type { ParsedCommand } from '../parse.ts'
import { runParamsCommand } from './params-command.ts'
import { runCuratorCommand, runMutationsCommand } from './curator-command.ts'
import { runDoctorCommand, type DoctorCommandContext } from './doctor-command.ts'
import { runRestoreCommand, runSkillRestoreCommand } from './restore-commands.ts'
import { runSkillHistoryCommand, runSkillUndoCommand } from './skill-history-commands.ts'
import {
  runDecisionCommand,
  runPendingCommand,
  type ApprovalCommandContext,
} from './approval-commands.ts'

/** What every extracted handler receives. */
export interface CommandHandlerContext extends ApprovalCommandContext {
  readonly input: string
  readonly provider?: SettingsProviderLike | undefined
  readonly ctx?: { get(name: string): unknown } | undefined
  readonly runs?: (() => { running: number; orphaned: number }) | undefined
  readonly refusal?: ((what: string) => CommandResult | undefined) | undefined
}

export type CommandHandler = (context: CommandHandlerContext) => Promise<CommandResult | undefined> | CommandResult | undefined

const isPendingShape = (command: ParsedCommand): boolean =>
  command.positionals.length === 0 && [...command.flags.keys()].every(flag => flag === 'detail')
const isParamsShape = (command: ParsedCommand): boolean =>
  command.positionals.length === 0 && [...command.flags.keys()].every(flag => flag === 'group' || flag === 'json')

export const HOST_COMMAND_HANDLERS: Readonly<Record<string, CommandHandler>> = {
  pending: context => isPendingShape(context.command) ? runPendingCommand(context) : undefined,
  approve: context => context.input.startsWith('approve ')
    ? runDecisionCommand('approve', context.input.slice(8).trim(), context)
    : undefined,
  reject: context => context.input.startsWith('reject ')
    ? runDecisionCommand('reject', context.input.slice(7).trim(), context)
    : undefined,
  release: context => context.input.startsWith('release ')
    ? runDecisionCommand('release', context.input.slice(8).trim(), context)
    : undefined,
  params: context => isParamsShape(context.command)
    ? runParamsCommand({ command: context.command, provider: context.provider, locale: context.locale })
    : undefined,
  curator: context => context.ctx === undefined
    ? undefined
    : runCuratorCommand({ input: context.input, ctx: context.ctx, locale: context.locale }),
  mutations: context => context.ctx === undefined
    ? undefined
    : runMutationsCommand({ input: context.input, ctx: context.ctx, locale: context.locale }),
  doctor: context => context.ctx === undefined || context.runs === undefined
    ? undefined
    : runDoctorCommand({
        input: context.input,
        ctx: context.ctx as DoctorCommandContext['ctx'],
        runs: context.runs,
        locale: context.locale,
      }),
  restore: context => context.ctx === undefined || context.refusal === undefined
    ? undefined
    : runRestoreCommand({ input: context.input, ctx: context.ctx, locale: context.locale, refusal: context.refusal }),
  'skill.restore': context => context.ctx === undefined || context.refusal === undefined
    ? undefined
    : runSkillRestoreCommand({ input: context.input, ctx: context.ctx, locale: context.locale, refusal: context.refusal }),
  'skill.history': context => context.ctx === undefined || context.refusal === undefined
    ? undefined
    : runSkillHistoryCommand({ input: context.input, ctx: context.ctx, locale: context.locale, refusal: context.refusal }),
  'skill.undo': context => context.ctx === undefined || context.refusal === undefined
    ? undefined
    : runSkillUndoCommand({ input: context.input, ctx: context.ctx, locale: context.locale, refusal: context.refusal }),
}
