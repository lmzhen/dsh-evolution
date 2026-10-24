/**
 * Read-only command handlers: status/pending/skipped are served from merge-state.
 * Mutating verbs return null so the host shell can route them to the run engine.
 */
import type { EvolutionIoLike, RunRecord } from '@deepseek-ai/dsh-evolution-core'
import type { MergeCliCommand } from './commands.ts'
import { buildFacts } from './facts.ts'
import { loadMergeState } from './state.ts'
import { formatFacts, formatQueue, formatStatus } from './status.ts'
import { mergeUsage } from './commands.ts'

export async function handleReadOnlyMergeCommand(
  command: MergeCliCommand,
  io: EvolutionIoLike,
  home: string,
  cards?: readonly { readonly name: string }[],
  runs?: readonly RunRecord[],
  approval = false,
): Promise<string | null> {
  const withNote = (text: string, note: string | undefined): string => note === undefined ? text : 'note: ' + note + '\n' + text
  const load = async () => {
    const result = await loadMergeState(io, home)
    if (result.note === 'merge-state-forward-only') throw new Error('merge-state-forward-only')
    return result
  }
  if (command.verb === 'status') {
    const loaded = await load()
    if (command.id !== undefined) {
      const row = loaded.state.rows.find(item => item.id === command.id)
      return withNote(row === undefined ? 'merge row not found: ' + command.id : formatStatus([row]), loaded.note)
    }
    const facts = buildFacts({ rows: loaded.state.rows, runs: runs ?? [], approval, readAt: Date.now(), ...(loaded.note === undefined ? {} : { notes: [loaded.note] }) })
    return withNote(formatFacts(facts), loaded.note)
  }
  if (command.verb === 'pending') {
    const loaded = await load()
    const rows = command.expired === true ? loaded.state.rows.filter(row => row.expired !== undefined) : loaded.state.rows
    const live = cards === undefined ? rows : rows.filter(row =>
      cards.some(card => card.name === row.a) && cards.some(card => card.name === row.b))
    return withNote(command.expired === true ? formatStatus(live) : formatQueue(live, 'pending'), loaded.note)
  }
  if (command.verb === 'candidates') {
    const loaded = await load()
    const rows = command.retry === true ? loaded.state.rows.filter(row => row.state === 'approved') : loaded.state.rows
    return withNote(formatQueue(rows, command.retry === true ? 'fuse' : 'verify'), loaded.note)
  }
  if (command.verb === 'skipped') {
    const loaded = await load()
    return withNote(formatQueue(loaded.state.rows, 'skipped'), loaded.note)
  }
  return null
}

export function mergeCommandHelp(): string {
  return mergeUsage()
}
