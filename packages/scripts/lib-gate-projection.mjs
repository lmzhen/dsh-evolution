// packages/scripts/lib-gate-projection.mjs - the ONE projection for gate rows (G0/0.5).
//
// Why this file exists: two scripts each derived "which gates belong to profile X" on their own,
// and the same word meant two different sets (pre-tag: declared rows = 49 vs union(local, ci) = 58).
// Both numbers were right; they counted different things. Two names now carry the two meanings,
// and both sets come from here so no third derivation can appear unnoticed.

export const RUNNABLE_KINDS = new Set(['script', 'toolchain'])
export const PROFILE_NAMES = ['local', 'pre-tag', 'ci']

/** profileOf: the profiles a row DECLARES (its own profiles array). No inference. */
export const profileOf = (row) => (Array.isArray(row.profiles) ? row.profiles : [])

/** declaredPreTag: rows that literally declare pre-tag. Taxonomy counts this: 49. */
export const declaredPreTag = (rows) => rows.filter((row) => profileOf(row).includes('pre-tag'))

/** supersetPreTag: union(local, ci) - what run-gates runs when asked for pre-tag: 58. */
export const supersetPreTag = (rows) => rows.filter((row) => {
  const p = profileOf(row)
  return p.includes('local') || p.includes('ci')
})

/** runnable: rows whose kind may be executed (run-gates filters by this; taxonomy does not). */
export const runnable = (rows) => rows.filter((row) => RUNNABLE_KINDS.has(row.kind))

// A profile literal outside the vocabulary is a BROKEN ROW, not a row to ignore: silently
// dropping it is how a gate leaves the run set without anyone noticing (G0/0.5 red proof).
export const unknownProfiles = (rows) => rows
  .map((row) => ({ id: row.id, bad: profileOf(row).filter((p) => !PROFILE_NAMES.includes(p)) }))
  .filter((entry) => entry.bad.length > 0)
