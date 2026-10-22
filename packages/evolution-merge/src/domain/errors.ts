/** Pure merge error rendering: parameter errors are two lines, runtime/target failures three. */
export type MergeErrorKind = 'parameter' | 'runtime' | 'target' | 'approval'

export interface MergeError {
  readonly kind: MergeErrorKind
  readonly code: string
  readonly message: string
  readonly detail?: string
  readonly stage?: string
  readonly runId?: string
}

export function formatMergeError(error: MergeError): string {
  if (error.kind === 'parameter') return 'merge: ' + error.message + ' (' + error.code + ')'
  const where = error.stage === undefined && error.runId === undefined
    ? (error.detail ?? 'no additional detail')
    : [error.stage === undefined ? undefined : 'stage=' + error.stage, error.runId === undefined ? undefined : 'run=' + error.runId].filter(Boolean).join(' ')
  return 'merge failed: ' + error.message + ' (' + error.code + ')\n' + where + '\nnext: fix the target or rerun after the cause is gone'
}
