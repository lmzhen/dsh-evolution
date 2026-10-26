/** Pure merge error rendering: parameter errors stay one line; command failures are code/hint/next. */
export type MergeErrorKind = 'parameter' | 'runtime' | 'target' | 'approval'

export interface MergeError {
  readonly kind: MergeErrorKind
  readonly code: string
  readonly message: string
  /** Reader-facing explanation; defaults to the message (plus detail). */
  readonly hint?: string
  /** The one next step; every runtime failure names one. */
  readonly next?: string
  readonly detail?: string
  readonly stage?: string
  readonly runId?: string
}

function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[redacted]')
    .replace(/ghp_[A-Za-z0-9]{20,}/g, '[redacted]')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[redacted]')
    .replace(/xox[baprs]-[A-Za-z0-9-]{10,}/g, '[redacted]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)\S+/gi, '$1[redacted]')
}

/** Build the typed failure every command/CLI/runtime branch returns. */
export function commandError(stage: string, code: string, hint: string, next: string, runId?: string): MergeError {
  return { kind: 'runtime', code, message: hint, hint, next, stage, ...(runId === undefined ? {} : { runId }) }
}

function oneLine(value: string): string {
  return value.replace(/\r?\n+/g, ' ').trim()
}

function render(error: MergeError): string {
  const where = [
    error.stage === undefined ? undefined : 'stage=' + error.stage,
    error.runId === undefined ? undefined : 'run=' + error.runId,
  ].filter((value): value is string => value !== undefined).join(', ')
  const heading = 'code: ' + error.code + (where === '' ? '' : ' (' + where + ')')
  const hint = 'hint: ' + oneLine(error.hint ?? [error.message, error.detail].filter((value): value is string => value !== undefined && value !== '').join(' — '))
  const next = 'next: ' + oneLine(error.next ?? error.detail ?? 'fix the target or rerun after the cause is gone')
  return redact([heading, hint, next].join('\n'))
}

/** Render a merge command failure: one line for syntax, three lines (code/hint/next) for runtime. */
export function formatMergeError(error: MergeError): string {
  if (error.kind === 'parameter') return 'merge: ' + error.message + ' (' + error.code + ')'
  return render(error)
}

/** A typed failure result: `message` is the rendered three-line text, `error` keeps the fields. */
export interface FailureResult {
  readonly ok: false
  readonly message: string
  readonly error: MergeError
}

export function failure(stage: string, code: string, hint: string, next: string, runId?: string): FailureResult {
  const error = commandError(stage, code, hint, next, runId)
  return { ok: false, message: formatMergeError(error), error }
}
