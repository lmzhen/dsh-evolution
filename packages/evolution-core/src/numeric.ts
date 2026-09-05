/**
 * Numeric config clamping for the dsh-evolution plugin family.
 *
 * G3.1 (0.3.23): numeric configuration values are normalised through a single
 * helper so 0 / negative / NaN / ±Infinity / out-of-range all fall back to the
 * package default instead of silently becoming a "disabled" special value or
 * folding as NaN into a computation. A non-finite value (NaN, ±Infinity) is
 * never a legitimate config, so it always falls back. The schema layer (a
 * `.min(1)` clamp on the number schema) is a first-line guard where it can
 * reject invalid values; this helper is the mandatory assembly-time clamp that
 * also catches what schemastery lets through (NaN and +Infinity both pass a
 * bare number schema).
 *
 * The scope here is pure numeric conversion only (no schemastery import), so
 * evolution-core stays free of a schemastery dependency. Per-package Config
 * schemas keep their own `.min()`/`.default()` call sites.
 * @module @deepseek-ai/dsh-evolution-core
 */

/**
 * Clamp a numeric config to the `[min, max]` range.
 *
 * A non-finite value (NaN, ±Infinity), a non-number, or a value outside the
 * inclusive range falls back to `fallback`. When `opts.min >= 1`, 0 and
 * negative values also fall back to `fallback` — a 0 is never treated as a
 * special "disabled" meaning (G3.1 decision). Callers that legitimately allow
 * 0 (e.g. a threshold or a zero-cost weight) pass `{ min: 0 }` or omit the
 * range.
 *
 * @param value - the raw numeric config, possibly `undefined` (absent).
 * @param fallback - the default value to return when the value is invalid.
 * @param opts - optional inclusive lower/upper bound.
 * @returns `value` when it is a finite number within range, else `fallback`.
 */
export function clampedNumber(value: number | undefined, fallback: number, opts?: { min?: number; max?: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const { min, max } = opts ?? {}
  if (min !== undefined && value < min) return fallback
  if (max !== undefined && value > max) return fallback
  return value
}
