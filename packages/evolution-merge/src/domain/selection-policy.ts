/** Batch 3 selection policy: filter managed/protected before writing skipped. */
import type { MergeCandidate } from '../contracts.ts'
export interface SelectionLike {
  readonly candidates: readonly MergeCandidate[]
  readonly skipped: readonly { readonly pairKey: string; readonly a: string; readonly b: string; readonly reason?: string }[]
  readonly reportOnly: readonly unknown[]
}
export function filterSelection<T extends SelectionLike>(selection: T, isManaged: (name: string) => boolean, isProtected: (name: string) => boolean): T {
  const skipped = selection.skipped.filter(item => isManaged(item.a) && isManaged(item.b) && !isProtected(item.a) && !isProtected(item.b))
  const candidates = selection.candidates.filter(item => isManaged(item.a) && isManaged(item.b) && !isProtected(item.a) && !isProtected(item.b))
  return { ...selection, candidates, skipped }
}
