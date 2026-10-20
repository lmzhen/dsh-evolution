/**
 * Read-only status projections for the merge command/panel. Pure formatting over rows; no
 * writes, no report reads. The UI and command parser share this vocabulary.
 */
import type { MergeQueue, MergeRow } from './contracts.ts'
import { queueOf, stageOf } from './contracts.ts'

export interface MergeCounts {
  readonly pending: number
  readonly retry: number
  readonly skipped: number
}

export function countRows(rows: readonly MergeRow[]): MergeCounts {
  const counts = { pending: 0, retry: 0, skipped: 0 }
  for (const row of rows) counts[queueOf(row.state)] += 1
  return counts
}

function describe(row: MergeRow): string {
  const stage = stageOf(row.state)
  const target = row.decision?.shouldMerge === true ? ' → ' + row.decision.target : ''
  return row.a + ' + ' + row.b + ' [' + row.state + (stage === null ? '' : '/' + stage) + ']' + target + (row.failure === undefined ? '' : ' — ' + row.failure.message)
}

export function formatStatus(rows: readonly MergeRow[]): string {
  const counts = countRows(rows)
  const lines = [
    'merge: pending ' + String(counts.pending) + ', retry ' + String(counts.retry) + ', skipped ' + String(counts.skipped),
  ]
  for (const row of rows) lines.push('- ' + describe(row))
  return lines.join('\n')
}

export function formatQueue(rows: readonly MergeRow[], queue: MergeQueue): string {
  const selected = rows.filter(row => queueOf(row.state) === queue)
  if (selected.length === 0) return 'merge ' + queue + ': empty'
  return ['merge ' + queue + ': ' + String(selected.length)].concat(selected.map(row => '- ' + describe(row))).join('\n')
}
