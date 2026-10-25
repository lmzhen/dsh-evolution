/** Generated merge CommandSurface from command-defs; no handwritten table. */
import type { ActionId, CommandActionRule, CommandSpec, CommandSurface } from './wire.ts'
import { buildSurface } from '@deepseek-ai/dsh-evolution-commands'
import { MERGE_COMMAND_DEFS } from './command-defs.ts'
const generated = buildSurface(MERGE_COMMAND_DEFS, '/evolution merge')
export const MERGE_COMMANDS: readonly CommandSpec[] = generated.commands.map(command => ({
  id: command.id, words: command.words, flags: command.flags, positional: command.positional,
  summary: command.id, readOnly: command.readOnly, needsRun: command.needsRun, defaults: command.defaults,
  rowActions: command.rowActions.map(action => ({ id: action.id as ActionId, command: action.command, confirm: action.confirm } as CommandActionRule)),
  fallback: command.fallback,
}))
export const MERGE_COMMAND_SURFACE: CommandSurface = { wireVersion: 1, prefix: '/evolution merge', commands: MERGE_COMMANDS, fallback: generated.fallback.map(item => ({ id: item.id, command: item.command })) }
