/** Pure presentation decisions for one merge row; no network or store state. */
export type PairSummary =
  | { readonly kind: 'same'; readonly text: string }
  | { readonly kind: 'different'; readonly a: string | null; readonly b: string | null }
  | { readonly kind: 'missing' }

/**
 * Compare the two source summaries after trimming. Equal non-empty text is one fact;
 * missing text stays missing rather than being invented.
 * @param a - source A summary, or null.
 * @param b - source B summary, or null.
 * @returns the presentation form.
 */
export function summarizePair(a: string | null | undefined, b: string | null | undefined): PairSummary {
  const left = a?.trim() ?? ''
  const right = b?.trim() ?? ''
  if (left === '' && right === '') return { kind: 'missing' }
  if (left !== '' && left === right) return { kind: 'same', text: left }
  return { kind: 'different', a: left === '' ? null : left, b: right === '' ? null : right }
}
