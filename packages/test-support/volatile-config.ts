/**
 * Test helpers for the platform's live config references (G1 §8.1).
 *
 * A plugin mounted through the Loader receives `Volatile` references for its volatile
 * Config fields, so a spec that constructs a plugin DIRECTLY supplies the same
 * reference. `Volatile<T>` is structurally `{ get(): T }`, so no platform import is
 * needed here.
 */

/**
 * A reference serving one fixed value.
 * @param value - the value to serve.
 * @returns the reference.
 */
export function vol<T>(value: T): { get(): T } {
  return { get: () => value }
}

/**
 * A reference whose value a test can move, standing in for the loader's live update.
 * @param initial - the value served before the first move.
 * @returns the reference and the setter that moves it.
 */
export function mutableVol<T>(initial: T): { ref: { get(): T }; set: (next: T) => void } {
  let current = initial
  return { ref: { get: () => current }, set: (next: T) => { current = next } }
}

/**
 * Read one parsed Config field: a volatile field parses into a live reference, a
 * plain deployment field is returned as it stands.
 * @param value - one field of a parsed Config.
 * @returns the current value behind the reference.
 */
export function plainValue<T>(value: T | { get(): T }): T {
  return typeof value === 'object' && value !== null && 'get' in value ? (value as { get(): T }).get() : value as T
}
