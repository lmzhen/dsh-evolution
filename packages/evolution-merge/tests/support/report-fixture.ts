import type { MergeReport, MergeReportPair } from '../../src/contracts.ts'

/** Minimal completed-run report for read-face specs (the run report is the pair source now). */
export function reportFixture(runId: string, pairs: readonly MergeReportPair[]): MergeReport {
  return {
    schemaVersion: 2,
    runId,
    kind: 'merge',
    command: 'approve',
    startedAt: 1,
    endedAt: 2,
    stopReason: 'completed',
    approval: { platformWrite: false, mergeApproval: false },
    scope: { candidatePairs: pairs.length, queueBefore: { verify: 0, pending: 0, fuse: 0, skipped: 0 } },
    pairs,
    totals: {
      merged: pairs.filter(pair => pair.outcome === 'merged').length,
      kept: pairs.filter(pair => pair.outcome === 'kept').length,
      pending: pairs.filter(pair => pair.outcome === 'pending').length,
      failed: pairs.filter(pair => pair.outcome === 'failed').length,
    },
    notes: [],
  }
}
