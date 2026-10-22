/**
 * Read-only command handlers: status/pending/skipped are served from merge-state.
 * Mutating verbs return null so the host shell can route them to the run engine.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { MergeCliCommand } from './commands.ts'
import { loadMergeState } from './state.ts'
import { formatQueue, formatStatus } from './status.ts'
import { mergeUsage } from './commands.ts'

export async function handleReadOnlyMergeCommand(
  command: MergeCliCommand,
  io: EvolutionIoLike,
  home: string,
  cards?: readonly { readonly name: string }[],
): Promise<string | null> {
  const withNote = (text: string, note: string | undefined): string => note === undefined ? text : 'note: ' + note + '\n' + text
  if (command.verb === 'status') {
    const loaded = await loadMergeState(io, home)
    if (command.id !== undefined) {
      const row = loaded.state.rows.find(item => item.id === command.id)
      return withNote(row === undefined ? 'merge row not found: ' + command.id : formatStatus([row]), loaded.note)
    }
    return withNote(formatStatus(loaded.state.rows), loaded.note)
  }
  if (command.verb === 'pending') {
    const loaded = await loadMergeState(io, home)
    const rows = command.expired === true ? loaded.state.rows.filter(row => row.expired !== undefined) : loaded.state.rows
    const live = cards === undefined ? rows : rows.filter(row =>
      cards.some(card => card.name === row.a) && cards.some(card => card.name === row.b))
    return withNote(command.expired === true ? formatStatus(live) : formatQueue(live, 'pending'), loaded.note)
  }
  if (command.verb === 'candidates') {
    const loaded = await loadMergeState(io, home)
    const rows = command.retry === true ? loaded.state.rows.filter(row => row.state === 'approved') : loaded.state.rows
    return withNote(formatQueue(rows, command.retry === true ? 'fuse' : 'verify'), loaded.note)
  }
  if (command.verb === 'skipped') {
    const loaded = await loadMergeState(io, home)
    return withNote(formatQueue(loaded.state.rows, 'skipped'), loaded.note)
  }
  return null
}

export function mergeCommandHelp(): string {
  return mergeUsage()
}
