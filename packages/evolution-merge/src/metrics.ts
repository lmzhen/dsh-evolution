/** RG6 merge metrics projection: stable names/labels from state + runs. */
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import type { MergeRow } from './contracts.ts'
import { countsOf } from './facts.ts'

export interface MetricSample {
  readonly name: string
  readonly labels: Readonly<Record<string, string>>
  readonly value: number
}

export interface MergeMetricCounters {
  readonly lockWaitMs?: number
  readonly claimConflict?: number
  readonly recoveryFail?: number
}

export const MERGE_METRIC_NAMES = [
  'merge_queue_depth',
  'merge_run_total',
  'merge_run_duration_ms',
  'merge_lock_wait_ms',
  'merge_claim_conflict_total',
  'merge_recovery_fail_total',
] as const

export function buildMergeMetrics(rows: readonly MergeRow[], runs: readonly RunRecord[], counters: MergeMetricCounters = {}): readonly MetricSample[] {
  const counts = countsOf(rows)
  const samples: MetricSample[] = []
  for (const queue of ['verify', 'pending', 'fuse', 'skipped'] as const) samples.push({ name: 'merge_queue_depth', labels: { queue, kind: 'active' }, value: counts.active[queue] })
  samples.push({ name: 'merge_queue_depth', labels: { queue: 'pending', kind: 'expired' }, value: counts.expired })
  for (const run of runs) {
    const state = run.mergeStatus ?? run.state
    samples.push({ name: 'merge_run_total', labels: { state }, value: 1 })
    if (run.endedAt !== undefined) samples.push({ name: 'merge_run_duration_ms', labels: { state }, value: Math.max(0, run.endedAt - run.startedAt) })
  }
  samples.push({ name: 'merge_lock_wait_ms', labels: {}, value: counters.lockWaitMs ?? 0 })
  samples.push({ name: 'merge_claim_conflict_total', labels: {}, value: counters.claimConflict ?? 0 })
  samples.push({ name: 'merge_recovery_fail_total', labels: {}, value: counters.recoveryFail ?? 0 })
  return samples
}
