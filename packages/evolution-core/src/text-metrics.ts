/**
 * One text-metrics source for every character-based budget in the family.
 *
 * A budget is not a language: the same text needs different units for storage,
 * display, context cost and quality heuristics. This module measures ONE string
 * once and exposes the four units; callers choose a unit through a named budget
 * instead of reaching for `String.length`, `[...text].length` or `slice()`.
 *
 * The token figure is deliberately an ESTIMATE. With no model tokenizer it uses
 * a script-neutral conservative upper bound (`utf8Bytes / 3`, floored by
 * `codePoints / 4`); a caller may inject a provider/model estimator later
 * without changing any budget.
 *
 * @module @deepseek-ai/dsh-evolution-core
 */

/** Units a text budget may use. */
export type TextUnit = 'utf8Bytes' | 'codePoints' | 'graphemes' | 'tokens'

/** One token estimate, with the measurement range kept visible for UI copy. */
export interface TokenEstimate {
  /** Conservative point estimate a gate should compare against. */
  readonly value: number
  /** Lower end of the model-agnostic range (never presented as an exact count). */
  readonly low: number
  /** Upper end of the model-agnostic range. */
  readonly high: number
  readonly source: 'unicode-heuristic' | 'platform' | 'model'
}

/** All units for one text, measured together so callers cannot drift. */
export interface TextMetrics {
  /** UTF-8 byte length. */
  readonly utf8Bytes: number
  /** Unicode scalar values (code points). */
  readonly codePoints: number
  /** User-perceived characters; falls back to code points without Intl.Segmenter. */
  readonly graphemes: number
  readonly tokens: TokenEstimate
  /** True when the runtime lacked Intl.Segmenter and graphemes are code points. */
  readonly degraded: boolean
}

/** Replaceable token estimator; a provider/model adapter can supply exact counts. */
export type TokenEstimator = (text: string) => TokenEstimate

interface GraphemeSegments {
  segment(input: string): Iterable<unknown>
}

type GraphemeSegmenterCtor = new (
  locales?: string | readonly string[],
  options?: { readonly granularity: 'grapheme' },
) => GraphemeSegments

const segmenterCtor = (Intl as unknown as { Segmenter?: GraphemeSegmenterCtor }).Segmenter
const segmenter: GraphemeSegments | undefined = segmenterCtor === undefined
  ? undefined
  : new segmenterCtor(undefined, { granularity: 'grapheme' })

/** UTF-8 byte length; TextEncoder is available on every Node/browser target this package runs on. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Unicode scalar-value count. */
export function codePointCount(text: string): number {
  let count = 0
  for (const _codePoint of text) count += 1
  return count
}

/**
 * User-perceived character count.
 * @param text - the string to measure.
 * @returns grapheme clusters, or code points when the runtime has no Segmenter.
 */
export function graphemeCount(text: string): number {
  if (segmenter === undefined) return codePointCount(text)
  let count = 0
  for (const _grapheme of segmenter.segment(text)) count += 1
  return count
}

/** Split a string without ever cutting through a grapheme cluster. */
function graphemeParts(text: string): readonly string[] {
  if (segmenter === undefined) return [...text]
  const parts: string[] = []
  for (const part of segmenter.segment(text)) {
    const value = (part as { readonly segment?: unknown }).segment
    if (typeof value === 'string') parts.push(value)
  }
  return parts
}

/** The pure estimate from already-counted bytes/code points. */
function estimateFromCounts(bytes: number, codePoints: number): TokenEstimate {
  if (bytes === 0) return { value: 0, low: 0, high: 0, source: 'unicode-heuristic' }
  const low = Math.ceil(codePoints / 4)
  const high = Math.ceil(bytes / 3)
  return { value: Math.max(low, high), low, high, source: 'unicode-heuristic' }
}

/**
 * Conservative, model-agnostic token estimate.
 *
 * English prose is about 4 characters/token; CJK prose is about 1 token/char.
 * UTF-8 bytes encode that difference naturally (3 bytes for CJK, 1 for ASCII),
 * so the upper bound is `bytes / 3` while `codePoints / 4` keeps the lower end
 * anchored to the common English heuristic. The point estimate is the upper
 * bound: early warnings are recoverable, silent over-budget is not.
 * @param text - the string to estimate.
 * @returns the estimate and its range; never an exact tokenizer count.
 */
export function conservativeTokenEstimator(text: string): TokenEstimate {
  return estimateFromCounts(utf8ByteLength(text), codePointCount(text))
}

/**
 * Measure every unit for one string in one pass over the text.
 * @param text - the raw string; body callers should pass the on-disk form.
 * @param estimator - optional exact/estimated token source; defaults to the conservative fallback.
 * @returns all units and the token range.
 */
export function measureText(text: string, estimator?: TokenEstimator): TextMetrics {
  const bytes = utf8ByteLength(text)
  const codePoints = codePointCount(text)
  return {
    utf8Bytes: bytes,
    codePoints,
    graphemes: graphemeCount(text),
    tokens: estimator === undefined ? estimateFromCounts(bytes, codePoints) : estimator(text),
    degraded: segmenter === undefined,
  }
}

/**
 * Read one unit from a fresh measurement.
 * @param text - the string to measure.
 * @param unit - the budget unit to read.
 * @param estimator - optional token source; ignored for non-token units.
 * @returns the numeric value in that unit.
 */
export function measureUnit(text: string, unit: TextUnit, estimator?: TokenEstimator): number {
  const metrics = measureText(text, estimator)
  switch (unit) {
    case 'utf8Bytes': return metrics.utf8Bytes
    case 'codePoints': return metrics.codePoints
    case 'graphemes': return metrics.graphemes
    case 'tokens': return metrics.tokens.value
  }
}

/**
 * Truncate to a grapheme budget without splitting emoji or combining sequences.
 * The ellipsis counts inside `max`, matching how UI budgets are described.
 * @param text - the string to shorten.
 * @param max - maximum output graphemes, ellipsis included.
 * @param ellipsis - marker appended when shortened; may itself be multi-grapheme.
 * @returns the original text or a grapheme-safe prefix plus marker.
 */
export function truncateGraphemes(text: string, max: number, ellipsis = '…'): string {
  if (!Number.isFinite(max) || max <= 0) return ''
  const limit = Math.floor(max)
  const parts = graphemeParts(text)
  if (parts.length <= limit) return text
  const marker = graphemeParts(ellipsis)
  if (marker.length >= limit) return marker.slice(0, limit).join('')
  return parts.slice(0, limit - marker.length).join('') + ellipsis
}
