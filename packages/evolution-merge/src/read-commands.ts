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
): Promise<string | null> {
  if (command.verb === 'status') {
    const loaded = await loadMergeState(io, home)
    if (command.id !== undefined) {
      const row = loaded.state.rows.find(item => item.id === command.id)
      return row === undefined ? 'merge row not found: ' + command.id : formatStatus([row])
    }
    return formatStatus(loaded.state.rows)
  }
  if (command.verb === 'pending') {
    const loaded = await loadMergeState(io, home)
    return formatQueue(loaded.state.rows, 'pending')
  }
  if (command.verb === 'skipped') {
    const loaded = await loadMergeState(io, home)
    return formatQueue(loaded.state.rows, 'skipped')
  }
  return null
}

export function mergeCommandHelp(): string {
  return mergeUsage()
}
