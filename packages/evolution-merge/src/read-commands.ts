/**
 * Read-only command handlers: all served from one MergeSnapshot; never writes.
 */
import type { EvolutionIoLike, RunRecord } from '@deepseek-ai/dsh-evolution-core'
import type { MergeCliCommand } from './commands.ts'
import { readMergeSnapshot } from './domain/merge-snapshot.ts'
import type { LiveRowFacts } from './domain/live-facts.ts'
import { buildFacts, toRowFact } from './surface/merge-view.ts'
import { formatFacts, formatSnapshotQueue, formatSnapshotStatus } from './status.ts'
import { mergeUsage } from './commands.ts'

export async function handleReadOnlyMergeCommand(
  command: MergeCliCommand,
  io: EvolutionIoLike,
  home: string,
  cards?: readonly { readonly name: string }[],
  runs?: readonly RunRecord[],
  approval = false,
  live?: () => Promise<LiveRowFacts | undefined>,
): Promise<string | null> {
  if (!['status', 'pending', 'candidates', 'skipped'].includes(command.verb)) return null
  const snapshot = await readMergeSnapshot({ io, home, runs: runs ?? [], approval, ...(live === undefined ? {} : { live }) })
  if (snapshot.blocked !== undefined) throw new Error(snapshot.blocked.code + ': ' + snapshot.blocked.message)
  const rows = snapshot.rows.map(toRowFact)
  if (command.verb === 'status') {
    if (command.id !== undefined) {
      const row = rows.find(item => item.id === command.id)
      return row === undefined ? 'merge row not found: ' + command.id : formatSnapshotStatus([row])
    }
    return formatFacts(buildFacts(snapshot))
  }
  if (command.verb === 'pending') {
    const live = command.expired === true ? rows.filter(row => row.expired !== undefined) : rows.filter(row => row.queue === 'pending' && row.expired === undefined)
    const filtered = cards === undefined ? live : live.filter(row => cards.some(card => card.name === row.a) && cards.some(card => card.name === row.b))
    return command.expired === true ? formatSnapshotStatus(filtered) : formatSnapshotQueue(filtered, 'pending')
  }
  if (command.verb === 'candidates') {
    const queue = command.retry === true ? 'fuse' : 'verify'
    return formatSnapshotQueue(rows.filter(row => row.queue === queue && (command.id === undefined || row.id === command.id)), queue)
  }
  return formatSnapshotQueue(rows.filter(row => row.queue === 'skipped'), 'skipped')
}

export function mergeCommandHelp(): string {
  return mergeUsage()
}
