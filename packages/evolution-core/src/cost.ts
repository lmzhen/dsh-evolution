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

import { UPSTREAM_LIMIT_CHARS_PER_TOKEN } from './constants.ts'
import { skillMdOnDisk } from './frontmatter.ts'

/** Token weight of one CJK / kana / full-width code unit on the LIMIT basis —
 * upstream's model-independent conversion is 2.75 chars/token for prose, and CJK
 * prose is ~1 token per character (the conservative end of the 0.6–1.0 range the
 * estimate side reports). Thresholds are compared on THIS basis so a borrowed
 * character line keeps its meaning; the estimate range below reports the spread. */
export const TOKEN_CJK_WEIGHT = 1
/** Token weight of one non-CJK code unit on the LIMIT basis (1 / 2.75 ≈ 0.364). */
export const TOKEN_ASCII_WEIGHT = 1 / UPSTREAM_LIMIT_CHARS_PER_TOKEN
/** Token-per-unit bounds of the estimate range (CJK: 0.6–1.0, non-CJK: 1/4–1/3).
 * The range is the 4-chars/token estimate family, so on ASCII-heavy bodies the
 * LIMIT-basis `tokens` point can sit above `tokensHigh` (1/2.75 > 1/3): the two
 * answer different questions and are never nested by construction. */
export const COST_CJK_TOKEN_LOW = 0.6
export const COST_CJK_TOKEN_HIGH = 1
export const COST_ASCII_TOKEN_LOW = 0.25
export const COST_ASCII_TOKEN_HIGH = 1 / 3

/** The token line a borrowed CHARACTER threshold draws for ONE body: 20k characters
 * of THIS composition, expressed in the same tokens `bodyCost` counts. Comparing
 * `tokens` against this line is deliberately equivalent to "chars >= line" — that
 * equivalence is what keeps a borrowed line's textual effect identical — while the
 * judgment itself, and every number reported, stays on the token scale.
 * @param lineChars - the borrowed character line (whole-body characters).
 * @param cost - the body's own cost breakdown.
 * @returns the equivalent token line (0 when the body is empty). */
export function tokenLineFor(lineChars: number, cost: BodyCost): number {
  if (cost.chars === 0) return 0
  return Math.round((lineChars * cost.tokens) / cost.chars)
}

/** Cost of one body: raw counts, the weighted total, and the estimate range. */
export interface BodyCost {
  /** Code units of the on-disk form — the same measure `maxSkillContentChars` bounds. */
  chars: number
  /** Code units matched by the CJK ranges. */
  cjk: number
  /** Code units that are not CJK (includes surrogate halves and syntax). */
  ascii: number
  /** Single token count on the LIMIT basis: `cjk * TOKEN_CJK_WEIGHT + ascii *
   * TOKEN_ASCII_WEIGHT`, rounded. This is the number every threshold compares
   * against, so a threshold borrowed as a character line converts faithfully. */
  tokens: number
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
    tokens: Math.round(cjk * TOKEN_CJK_WEIGHT + ascii * TOKEN_ASCII_WEIGHT),
    tokensLow: Math.round(cjk * COST_CJK_TOKEN_LOW + ascii * COST_ASCII_TOKEN_LOW),
    tokensHigh: Math.round(cjk * COST_CJK_TOKEN_HIGH + ascii * COST_ASCII_TOKEN_HIGH),
  }
}
