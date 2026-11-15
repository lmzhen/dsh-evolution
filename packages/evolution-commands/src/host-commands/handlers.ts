/**
 * Dispatch table for the handler slices that have left index.ts. Keys are the parser's
 * command names today; the remaining if-branches move here one aggregate at a time.
 * @module evolution-commands/src/host-commands/handlers
 */
import type { CommandResult } from '@deepseek-ai/dsh-evolution-core/platform'
import type { SettingsProviderLike } from '@deepseek-ai/dsh-evolution-core'
import type { ParsedCommand } from '../parse.ts'
import { runParamsCommand } from './params-command.ts'
import { runCuratorCommand } from './curator-command.ts'
import {
  runDecisionCommand,
  runPendingCommand,
  type ApprovalCommandContext,
} from './approval-commands.ts'

/** What every extracted handler receives. */
export interface CommandHandlerContext extends ApprovalCommandContext {
  /** The raw text after `/evolution`; the four approval handlers keep the old slice shape. */
  readonly input: string
  /** The settings provider, for the read-only params surface. */
  readonly provider?: SettingsProviderLike | undefined
  /** The plugin context, for handlers that read a family service. */
  readonly ctx?: { get(name: string): unknown } | undefined
}

/** A handler returns undefined when the command shape is not its own, so the legacy chain can answer. */
export type CommandHandler = (context: CommandHandlerContext) => Promise<CommandResult | undefined> | CommandResult | undefined

const isPendingShape = (command: ParsedCommand): boolean =>
  command.positionals.length === 0 && [...command.flags.keys()].every(flag => flag === 'detail')
const isParamsShape = (command: ParsedCommand): boolean =>
  command.positionals.length === 0 && [...command.flags.keys()].every(flag => flag === 'group' || flag === 'json')

/** The extracted handlers. Grow this map as each aggregate moves; do not add a second parser. */
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
}
