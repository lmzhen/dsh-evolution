/**
 * The family's ONE live-config reader.
 *
 * A config field reaches a plugin in two shapes: the platform's schema parser turns a
 * `.volatile()` declaration into a live reference (`{ get() }`, routed through cosmokit's
 * `createVolatile`), while a hand-built or pre-parse config carries the plain value. Reading a
 * live reference as if it were a value is SILENT (a boolean compare is simply never true, a
 * number folds as NaN) — so the two shapes are unwrapped in exactly one place here, and every
 * reader below goes through it.
 *
 * This module owns no policy: clamping semantics stay in `clampedNumber` (numeric.ts), and the
 * once-per-key warning text/rhythm is the one `clampOnce` has always had (it moved here so the
 * read happens in one place; callers import it from the package barrel, so the move is invisible).
 *
 * @module @deepseek-ai/dsh-evolution-core
 */
import { clampedNumber } from './numeric.ts'

/**
 * Canonical type of a config field that may arrive as a live reference or a plain value.
 *
 * Spelled STRUCTURALLY on purpose: the platform's `Volatile<T>` (cordis) satisfies it for every payload
 * shape, so a field declared `Volatile<number | undefined>` and one declared `Volatile<number>` both pass
 * without the readers importing cordis or narrowing the payload. Where a plugin wants the
 * canonical spelling it may still write `Volatile<T>` in its own Config.
 */
export type LiveValue<T> = T | { get(): T | undefined } | undefined

/**
 * Unwrap a live reference; return a plain value unchanged. The ONLY place that decides the shape.
 *
 * The discriminant is `typeof get === 'function'` rather than a bare `typeof value === 'object'`: a
 * config field may legitimately carry an object (a policy record), and calling `.get()` on that
 * used to throw where a plain read was meant.
 *
 * @param value - the field as supplied: live reference, plain value, or absent.
 * @returns the plain value, or `undefined` when the reference/field is absent.
 */
export function unwrapLive<T>(value: LiveValue<T>): T | undefined {
  // Read as unknown: the discriminant is a RUNTIME shape check, so every narrowing below is real
  // (a null test against the declared union would be a tautology the linter rejects).
  const raw: unknown = value
  if (typeof raw !== 'object' || raw === null) return raw as T | undefined
  const candidate = raw as { get?: unknown }
  return typeof candidate.get === 'function' ? (candidate.get as () => T | undefined).call(raw) : (raw as T)
}

/** Options for {@link liveNumber}; the warning triple is all-or-nothing. */
export interface LiveNumberOptions {
  /** Inclusive lower bound; omit for no lower bound (0 is then a legitimate value). */
  readonly min?: number
  /** Inclusive upper bound. */
  readonly max?: number
  /** The keys this caller already warned about (caller-owned, so the warning stays once-per-key). */
  readonly warned?: Set<string>
  /** The warning sink (each package prefixes its own name). */
  readonly warn?: (message: string) => void
  /** The config key, for the warning text. Required together with `warned` and `warn`. */
  readonly name?: string
}

/**
 * Read a numeric knob (live or plain) and clamp it, warning ONCE per key.
 *
 * @param value - the field as supplied: live reference, plain value, or absent.
 * @param fallback - the package default an invalid value falls back to.
 * @param opts - bounds plus the optional warning triple.
 * @returns the value the engine may use.
 */
export function liveNumber(value: LiveValue<number>, fallback: number, opts: LiveNumberOptions = {}): number {
  const current = unwrapLive(value)
  const { min, max } = opts
  // Built conditionally, not `{ min, max }`: under exactOptionalPropertyTypes a present-but-undefined
  // property is not the same as an absent one, and clampedNumber's bounds are optional.
  const bounds = min === undefined
    ? (max === undefined ? undefined : { max })
    : (max === undefined ? { min } : { min, max })
  const result = clampedNumber(current, fallback, bounds)
  const name = opts.name
  if (current !== undefined && result !== current && name !== undefined && opts.warn !== undefined) {
    const warned = opts.warned ?? new Set<string>()
    if (!warned.has(name)) {
      warned.add(name)
      opts.warn(`${name} provided an invalid value; falling back to the default`)
    }
  }
  return result
}

/**
 * Clamp one numeric knob and warn ONCE per key — the pre-0.22 signature, kept as a thin adapter so
 * existing callers migrate one at a time instead of in one commit.
 *
 * @param warned - the keys this caller already warned about.
 * @param warn - the warning sink (each package prefixes its own name).
 * @param name - the config key, for the warning.
 * @param value - the value as supplied, or its live reference.
 * @param fallback - the package default a corrected value falls back to.
 * @param min - the smallest value the engine can act on.
 * @param max - the largest value the carrier can hold, when bounded.
 * @returns the value the engine may use.
 */
export function clampOnce(
  warned: Set<string>,
  warn: (message: string) => void,
  name: string,
  value: LiveValue<number>,
  fallback: number,
  min: number,
  max?: number,
): number {
  return liveNumber(value, fallback, { min, ...(max === undefined ? {} : { max }), warned, warn, name })
}

/**
 * Read a boolean flag (live or plain). Absent ⇒ `fallback` (default `false`).
 *
 * The boolean counterpart of {@link liveNumber}: `value === true` is never true for a live
 * reference, which is the silent failure this reader exists to prevent.
 */
export function liveBool(value: LiveValue<boolean>, fallback = false): boolean {
  return unwrapLive(value) ?? fallback
}

/**
 * Read a string (live or plain). Blank/whitespace counts as unset — the same rule `evolutionRoot` uses
 * for `DSH_HOME`.
 */
export function liveString(value: LiveValue<string>, fallback: string): string {
  const current = unwrapLive(value)?.trim()
  return current === undefined || current.length === 0 ? fallback : current
}

/**
 * Read an enumerated string (live or plain); a value outside `allowed` falls back.
 *
 * Used for the mode-like knobs (review mode, trigger, citation policy, write-confirm mode) where a
 * bare `?? default` would accept a typo the schema never saw.
 */
export function liveEnum<T extends string>(value: LiveValue<T>, allowed: readonly T[], fallback: T): T {
  const current = unwrapLive(value)
  return current !== undefined && allowed.includes(current) ? current : fallback
}
