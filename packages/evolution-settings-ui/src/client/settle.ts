/**
 * The save verdict: did the Host take the values this card asked for?
 *
 * A write promise that resolves is not a verdict. Both settings scopes this bundle runs
 * on finish a recovery read before it resolves, so a value the Host refused is simply
 * still the previous one. Presence in the user layer cannot tell refusal from acceptance
 * on a field the operator had already overridden — the refused value's key is present
 * too — so the verdict compares what each staged id holds now against what was requested.
 * @module @deepseek-ai/dsh-evolution-settings-ui
 */

/** One staged write awaiting its verdict. */
export interface PendingWrite {
  /** Parameter id the write named. */
  readonly id: string
  /** The value handed to the scope's `set`. */
  readonly want: unknown
}

/**
 * Structural equality for the values a parameter can hold.
 *
 * T5-10: the comparison walks the value instead of comparing serializations, because key ORDER is
 * not part of an object's value — `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` are the same value, but
 * their `JSON.stringify` output differs, and the card then read a save that HAD landed as refused
 * (draft kept, error line shown). Array order IS part of an array's value, so arrays compare
 * element-wise. `NaN` equals itself through the `Object.is` fast path; other primitives use `===`,
 * which keeps `0` and `-0` equal exactly as the serialization comparison did.
 * @param a - one side of the comparison.
 * @param b - the other side.
 * @returns true when the two are the same value.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => sameValue(item, (b as readonly unknown[])[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
}

/**
 * Whether every staged write is visible in the user layer.
 * @param pending - the writes awaiting a verdict.
 * @param user - the user layer of the post-write snapshot; a non-section reads as empty.
 * @returns true when each staged id now holds the value that was requested.
 */
export function landedWrites(pending: readonly PendingWrite[], user: unknown): boolean {
  const section = typeof user === 'object' && user !== null && !Array.isArray(user) ? (user as Record<string, unknown>) : {}
  return pending.every(entry => sameValue(section[entry.id], entry.want))
}
