// @tier pre-tag
import { expect, it } from 'vitest'
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import type { MergeRow } from '../../src/contracts.ts'
import { buildMergeMetrics, MERGE_METRIC_NAMES } from '../../src/metrics.ts'

it('exposes the stable RG6 metric names and labels', () => {
  const rows: MergeRow[] = [{ id: 'r', pairKey: 'a|b', a: 'a', b: 'b', state: 'pending', queue: 'pending', createdAt: 'x', updatedAt: 'x' }]
  const runs: RunRecord[] = [{ id: 'run', kind: 'merge', state: 'succeeded', startedAt: 1, endedAt: 11, command: 'scan', mergeStatus: 'succeeded' }]
  const samples = buildMergeMetrics(rows, runs, { lockWaitMs: 5, claimConflict: 2, recoveryFail: 1 })
  for (const name of MERGE_METRIC_NAMES) expect(samples.some(sample => sample.name === name), name).toBe(true)
  expect(samples.find(sample => sample.name === 'merge_queue_depth' && sample.labels.kind === 'active' && sample.labels.queue === 'pending')?.value).toBe(1)
  expect(samples.find(sample => sample.name === 'merge_run_duration_ms')?.value).toBe(10)
})
