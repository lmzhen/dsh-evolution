/** Pure merge error rendering: parameter errors are two lines, runtime/target failures three. */
export type MergeErrorKind = 'parameter' | 'runtime' | 'target' | 'approval'

export interface MergeError {
  readonly kind: MergeErrorKind
  readonly code: string
  readonly message: string
  readonly detail?: string
}

export function formatMergeError(error: MergeError): string {
  if (error.kind === 'parameter') return 'merge: ' + error.message + ' (' + error.code + ')'
  const detail = '\n' + (error.detail ?? 'no additional detail')
  return 'merge failed: ' + error.message + ' (' + error.code + ')' + detail + '\nnext: fix the target or rerun after the cause is gone'
}
