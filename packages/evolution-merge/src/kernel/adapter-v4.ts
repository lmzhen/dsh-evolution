/** V4 -> kernel shadow adapter. Read-only characterization; no writes. */
import type { MergeFailure } from '../contracts.ts'
import type { V4Row } from '../domain/row-v4.ts'
import type { ClosedReason, Failure, MergeDecision, PairSnapshot } from './model.ts'

export interface V4AdapterResult {
  readonly snapshot: PairSnapshot
  readonly warnings: readonly string[]
}

function decisionOf(row: Extract<V4Row, { decision: unknown }>): MergeDecision {
  return { target: row.target, sources: row.decision.sources, ...(row.decision.rationale === undefined ? {} : { rationale: row.decision.rationale }) }
}

function failureOfRow(failure: MergeFailure): Failure {
  const known = new Set(['source-gone', 'source-changed', 'target-taken', 'validation-failed', 'commit-failed', 'schema-invalid', 'timeout', 'capability-missing', 'runtime'])
  const code = known.has(failure.code) ? failure.code as Failure['code'] : 'runtime'
  return { code, stage: failure.stage === 'screening' ? 'screen' : failure.stage === 'decide' ? 'decide' : failure.stage === 'author' ? 'author' : failure.stage === 'validate' ? 'validate' : 'commit', retryable: failure.retryable, reportOnly: true, userMessageKey: 'failure.' + code, detail: failure.message }
}

function closedReasonOf(row: Extract<V4Row, { state: 'skipped' }>): ClosedReason {
  if (row.reason.includes('merge-over-limit') || row.reason.includes('over-limit')) return 'over-limit'
  return row.origin === 'human' ? 'reject' : 'keep'
}

export function fromV4Row(row: V4Row): V4AdapterResult {
  const warnings: string[] = []
  const base = { id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt, origin: row.origin, attempts: row.attempts, ...(row.runId === undefined ? {} : { runId: row.runId }) }
  if (row.failure !== undefined) {
    warnings.push('row carries failure; kernel state=failed (current row state=' + row.state + ')')
    return { snapshot: { ...base, state: 'failed', failure: failureOfRow(row.failure) }, warnings }
  }
  if (row.state === 'verify') {
    return { snapshot: { ...base, state: row.verifySubState === 'screened' ? 'deciding' : 'candidate' }, warnings }
  }
  if (row.state === 'pending') {
    if (row.expired !== undefined) {
      warnings.push('pending expired without a timestamp; kernel state=expired')
      return { snapshot: { ...base, state: 'expired', target: row.target, decision: decisionOf(row), approval: 'on' }, warnings }
    }
    return { snapshot: { ...base, state: 'pending', target: row.target, decision: decisionOf(row), approval: 'on' }, warnings }
  }
  if (row.state === 'approved') return { snapshot: { ...base, state: 'approved', target: row.target, decision: decisionOf(row), approval: 'off' }, warnings }
  if (row.state === 'fuse') {
    warnings.push('current fuse row has no stagingRef; kernel state=authoring')
    return { snapshot: { ...base, state: 'authoring', target: row.target, decision: decisionOf(row), approval: 'off' }, warnings }
  }
  if (row.expiredAt !== undefined) {
    warnings.push('skipped-expired row maps to closed+expiresAt, not a failure')
    return { snapshot: { ...base, state: 'closed', closedReason: closedReasonOf(row), expiresAt: row.expiredAt }, warnings }
  }
  return { snapshot: { ...base, state: 'closed', closedReason: closedReasonOf(row) }, warnings }
}

export function fromV4Rows(rows: readonly V4Row[]): { readonly snapshots: readonly PairSnapshot[]; readonly warnings: readonly string[] } {
  const snapshots: PairSnapshot[] = []
  const warnings: string[] = []
  for (const row of rows) {
    const result = fromV4Row(row)
    snapshots.push(result.snapshot)
    for (const warning of result.warnings) warnings.push(row.id + ': ' + warning)
  }
  return { snapshots, warnings }
}
