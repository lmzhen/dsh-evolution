/**
 * Context-cost accounting for skill bodies (design §5.2).
 *
 * A raw character count is a poor budget: the same 100k characters cost very
 * different amounts of context in Chinese-heavy prose and in English. The
 * weighted unit makes the two comparable, and the token range exists only to
 * make the load cost visible next to the character count — it is an ESTIMATE,
 * never a measurement.
 *
 * Accounting basis: the ON-DISK form (`skillMdOnDisk()`, the same view the
 * write limit uses), so a body that is exactly at the limit cannot read as
 * over-limit here and pass there (the v37 P2-1 deadlock class).
 */

import { skillMdOnDisk } from './frontmatter.ts'

/** Weight of one CJK / kana / full-width code unit, in cost units. */
export const COST_CJK_WEIGHT = 1
/** Weight of one code unit that is not CJK (latin, digits, syntax), in cost units. */
export const COST_ASCII_WEIGHT = 0.25
/** Token-per-unit bounds of the estimate range (CJK: 0.6–1.0, non-CJK: 1/4–1/3). */
export const COST_CJK_TOKEN_LOW = 0.6
export const COST_CJK_TOKEN_HIGH = 1
export const COST_ASCII_TOKEN_LOW = 0.25
export const COST_ASCII_TOKEN_HIGH = 1 / 3

/** Weighted unit ceiling derived from a character ceiling: the ONE conversion
 * used by every threshold that pairs a char budget with a cost budget, so the
 * two can never drift apart (the character limit is calibrated on prose where
 * one character is cheap; CJK prose reaches the same char count for ~4x the
 * cost).
 * @param softBodyChars - the character ceiling to convert.
 * @returns the equivalent cost-unit ceiling, rounded. */
export function softCostUnitsFor(softBodyChars: number): number {
  return Math.round(softBodyChars * COST_ASCII_WEIGHT)
}

/** Cost of one body: raw counts, the weighted total, and the estimate range. */
export interface BodyCost {
  /** Code units of the on-disk form — the same measure `maxSkillContentChars` bounds. */
  chars: number
  /** Code units matched by the CJK ranges. */
  cjk: number
  /** Code units that are not CJK (includes surrogate halves and syntax). */
  ascii: number
  /** `cjk * COST_CJK_WEIGHT + ascii * COST_ASCII_WEIGHT`, rounded. */
  units: number
  /** Lower bound of the token estimate. */
  tokensLow: number
  /** Upper bound of the token estimate. */
  tokensHigh: number
}

/** CJK ideographs, kana, full-width forms and CJK punctuation. */
const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g

/**
 * Cost of one skill body.
 * @param content - the body text as written (trailing whitespace is normalized
 *   away by the on-disk accounting, so callers need not pre-trim).
 * @returns the cost breakdown; an empty body answers all-zero.
 */
export function bodyCost(content: string): BodyCost {
  const onDisk = skillMdOnDisk(content)
  const cjk = [...onDisk.matchAll(CJK_RE)].length
  const chars = onDisk.length
  const ascii = chars - cjk
  return {
    chars,
    cjk,
    ascii,
    units: Math.round(cjk * COST_CJK_WEIGHT + ascii * COST_ASCII_WEIGHT),
    tokensLow: Math.round(cjk * COST_CJK_TOKEN_LOW + ascii * COST_ASCII_TOKEN_LOW),
    tokensHigh: Math.round(cjk * COST_CJK_TOKEN_HIGH + ascii * COST_ASCII_TOKEN_HIGH),
  }
}
