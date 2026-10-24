/** G3-5 RowTx pure write API: only createVerify/createSkipped/transition. */
import { isV3Row, transitionV3, type SkippedRowV3, type V3Event, type V3Row, type VerifyRowV3 } from './row-v3.ts'

export type RowWrite =
  | { readonly kind: 'createVerify'; readonly row: VerifyRowV3 }
  | { readonly kind: 'createSkipped'; readonly row: SkippedRowV3 }
  | { readonly kind: 'transition'; readonly id: string; readonly event: V3Event; readonly expectedVersion: number }

type RowWriteErrorCode = 'row-invalid' | 'row-duplicate' | 'row-not-found' | 'version-conflict' | 'illegal-transition'
export type RowWriteResult =
  | { readonly ok: true; readonly rows: readonly V3Row[]; readonly row: V3Row | null }
  | { readonly ok: false; readonly code: RowWriteErrorCode; readonly message: string }

function bad(code: RowWriteErrorCode, message: string): RowWriteResult { return { ok: false, code, message } }

export function applyRowWrite(rows: readonly V3Row[], write: RowWrite, at: string): RowWriteResult {
  if (write.kind === 'transition') {
    const index = rows.findIndex(row => row.id === write.id)
    if (index < 0) return bad('row-not-found', 'row not found: ' + write.id)
    const current = rows[index]!
    const moved = transitionV3(current, write.event, write.expectedVersion, at)
    if (!moved.ok) return bad(moved.code, moved.message)
    if (moved.row === null) return { ok: true, rows: rows.filter((_, atIndex) => atIndex !== index), row: null }
    const next = [...rows]; next[index] = moved.row
    return { ok: true, rows: next, row: moved.row }
  }
  if (write.row.version !== 0) return bad('row-invalid', 'create requires version 0')
  if (write.kind === 'createVerify' && (write.row.state !== 'verify' || write.row.verifySubState !== 'unverified')) return bad('row-invalid', 'createVerify requires verify/unverified')
  if (write.kind === 'createSkipped' && write.row.state !== 'skipped') return bad('row-invalid', 'createSkipped requires skipped')
  if (!isV3Row(write.row)) return bad('row-invalid', 'created row is invalid')
  if (rows.some(row => row.id === write.row.id)) return bad('row-duplicate', 'duplicate row id: ' + write.row.id)
  return { ok: true, rows: [...rows, write.row], row: write.row }
}
