/** Pure failure taxonomy: the ONE place a code becomes a route. */
import type { ClosedReason, Failure, FailureCode, FailureStage } from './model.ts'

interface FailureSpec {
  readonly stage: FailureStage
  readonly retryable: boolean
  readonly reportOnly: boolean
  readonly userMessageKey: string
}

const TABLE: Readonly<Record<FailureCode, FailureSpec>> = {
  'bad-pair': { stage: 'command', retryable: true, reportOnly: false, userMessageKey: 'failure.bad-pair' },
  'bad-target': { stage: 'command', retryable: true, reportOnly: false, userMessageKey: 'failure.bad-target' },
  'bad-flag': { stage: 'command', retryable: true, reportOnly: false, userMessageKey: 'failure.bad-flag' },
  'source-gone': { stage: 'decide', retryable: true, reportOnly: true, userMessageKey: 'failure.source-gone' },
  'source-changed': { stage: 'commit', retryable: true, reportOnly: true, userMessageKey: 'failure.source-changed' },
  'target-taken': { stage: 'commit', retryable: false, reportOnly: true, userMessageKey: 'failure.target-taken' },
  'validation-failed': { stage: 'validate', retryable: true, reportOnly: true, userMessageKey: 'failure.validation' },
  'commit-failed': { stage: 'commit', retryable: false, reportOnly: true, userMessageKey: 'failure.commit' },
  'schema-invalid': { stage: 'schema', retryable: false, reportOnly: true, userMessageKey: 'failure.schema' },
  timeout: { stage: 'run', retryable: true, reportOnly: true, userMessageKey: 'failure.timeout' },
  'capability-missing': { stage: 'surface', retryable: false, reportOnly: false, userMessageKey: 'failure.capability' },
  runtime: { stage: 'run', retryable: true, reportOnly: true, userMessageKey: 'failure.runtime' },
}

export function failureOf(code: FailureCode, detail?: string): Failure {
  const spec = TABLE[code]
  return { code, stage: spec.stage, retryable: spec.retryable, reportOnly: spec.reportOnly, userMessageKey: spec.userMessageKey, ...(detail === undefined ? {} : { detail }) }
}

/** Only policy closures are closed; failures never map here. */
export function closedReasonFor(code: string): ClosedReason | undefined {
  if (code === 'merge-over-limit') return 'over-limit'
  if (code === 'keep') return 'keep'
  if (code === 'reject') return 'reject'
  return undefined
}

export function isFailureRoute(reportOnly: boolean): boolean {
  return reportOnly
}

export const FAILURE_CODES: readonly FailureCode[] = Object.keys(TABLE) as FailureCode[]
