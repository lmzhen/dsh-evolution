/**
 * The family's plain-object predicate, in ONE place (v46 G7.1 / audit A8).
 *
 * The audit found the same guard — "a non-null object that is not an array" — rewritten fifteen
 * times across nine packages, four times inside core itself, and with two byte-identical `asRecord`
 * copies in evolution-policy and evolution-threat. This module is the single definition; callers
 * import it instead of spelling the clause again.
 *
 * @module @deepseek-ai/dsh-evolution-core
 */

/**
 * Is this a non-null, non-array object (what JSON calls an object)?
 * @param value - the value to test.
 * @returns whether it is a plain object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a value as a record, or undefined when it is not one.
 * @param value - the value to read.
 * @returns the value typed as a record, or undefined.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}
