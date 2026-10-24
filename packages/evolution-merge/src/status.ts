/**
 * Read-only status projections for the merge command/panel. Pure formatting over rows; no
 * writes, no report reads. The UI and command parser share this vocabulary.
 */
import type { MergeQueue, MergeRow } from './contracts.ts'
import type { Facts, RunsView } from './wire.ts'
import { queueOf, stageOf } from './contracts.ts'
import { fitToolText } from './presentation-budget.ts'

export interface MergeCounts {
  readonly verify: number
  readonly pending: number
  readonly fuse: number
  readonly skipped: number
}

export function countRows(rows: readonly MergeRow[]): MergeCounts {
  const counts = { verify: 0, pending: 0, fuse: 0, skipped: 0 }
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
    'merge: verify ' + String(counts.verify) + ', pending ' + String(counts.pending) + ', fuse ' + String(counts.fuse) + ', skipped ' + String(counts.skipped),
  ]
  for (const row of rows) lines.push('- ' + describe(row))
  return fitToolText(lines.join('\n'))
}

export function formatFacts(facts: Facts): string {
  const lines = [
    'merge: verify ' + String(facts.counts.active.verify) + ', pending ' + String(facts.counts.active.pending) + ', fuse ' + String(facts.counts.active.fuse) + ', skipped ' + String(facts.counts.active.skipped) + ', expired ' + String(facts.counts.expired),
  ]
  if (facts.active !== null) lines.push('active: ' + facts.active.id + ' [' + facts.active.state + ']')
  if (facts.last !== null) lines.push('last: ' + facts.last.id + ' [' + facts.last.state + ']')
  if (facts.degraded) lines.push('degraded: ' + facts.notes.join(','))
  return fitToolText(lines.join('\n'))
}

export function formatRunsView(view: RunsView): string {
  if (view.runs.length === 0) return 'merge runs: empty'
  return fitToolText(['merge runs: ' + String(view.runs.length)].concat(view.runs.map(run => '- ' + run.id + ' [' + run.state + ']' + (run.endedAt === undefined ? '' : ' ' + new Date(run.endedAt).toISOString()))).join('\n'))
}

export function formatQueue(rows: readonly MergeRow[], queue: MergeQueue): string {
  const selected = rows.filter(row => queueOf(row.state) === queue)
  if (selected.length === 0) return 'merge ' + queue + ': empty'
  return fitToolText(['merge ' + queue + ': ' + String(selected.length)].concat(selected.map(row => '- ' + describe(row))).join('\n'))
}
