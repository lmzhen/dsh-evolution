import { describe, expect, it } from 'vitest'
import { AUTHORING_SPLIT_LINE_CHARS, UPSTREAM_LIMIT_CHARS_PER_TOKEN, bodyCost, tokenLineFor, COST_ASCII_TOKEN_HIGH, COST_ASCII_TOKEN_LOW, COST_CJK_TOKEN_HIGH, COST_CJK_TOKEN_LOW, DEFAULT_HEALTH_THRESHOLDS } from '@deepseek-ai/dsh-evolution-core'

// Every expectation is stated on the ON-DISK form: the accounting basis appends
// one trailing newline, the same measure `maxSkillContentChars` bounds.
describe('bodyCost (design §5.2)', () => {
  it('weighs a CJK body one token per code unit', () => {
    const cost = bodyCost('中'.repeat(10))
    expect(cost).toMatchObject({ chars: 11, cjk: 10, ascii: 1, tokens: 10 })
    expect(cost.tokensLow).toBe(Math.round(10 * COST_CJK_TOKEN_LOW + COST_ASCII_TOKEN_LOW))
    expect(cost.tokensHigh).toBe(Math.round(10 * COST_CJK_TOKEN_HIGH + COST_ASCII_TOKEN_HIGH))
  })

  it('weighs a latin body on the LIMIT basis (2.75 chars/token)', () => {
    const cost = bodyCost('a'.repeat(100))
    // 101 ASCII code units (100 + the on-disk newline) / 2.75 = 36.7 -> 37 tokens.
    expect(cost).toMatchObject({ chars: 101, cjk: 0, ascii: 101, tokens: 37 })
    expect(cost.tokensLow).toBe(Math.round(101 * COST_ASCII_TOKEN_LOW))
    expect(cost.tokensHigh).toBe(Math.round(101 * COST_ASCII_TOKEN_HIGH))
  })

  it('adds the two scripts for a mixed body', () => {
    expect(bodyCost('中文abcd')).toMatchObject({ chars: 7, cjk: 2, ascii: 5, tokens: 4 })
  })

  it('accounts on the ON-DISK form, so trailing whitespace cannot change the number', () => {
    const base = '中'.repeat(50) + 'a'.repeat(50)
    expect(bodyCost(base)).toEqual(bodyCost(base + '\n\n  '))
  })

  it('borrows the upstream split line as the threshold, and judges it in tokens (V6)', () => {
    // The configured number IS upstream's line (20k characters) — no unit drift in
    // config; the judgment converts it per body composition.
    expect(DEFAULT_HEALTH_THRESHOLDS.softBodyChars).toBe(AUTHORING_SPLIT_LINE_CHARS)
    const ascii = bodyCost('a'.repeat(AUTHORING_SPLIT_LINE_CHARS))
    const cjk = bodyCost('中'.repeat(AUTHORING_SPLIT_LINE_CHARS))
    // A 20k-character body of EITHER script sits exactly on its own line: the
    // textual trigger is "20k characters" while the scale is tokens.
    // Within one token: the on-disk form adds a newline, so the line is the
    // ratio of a 20,001-character body (rounding can differ by one).
    expect(Math.abs(ascii.tokens - tokenLineFor(AUTHORING_SPLIT_LINE_CHARS, ascii))).toBeLessThanOrEqual(1)
    expect(Math.abs(cjk.tokens - tokenLineFor(AUTHORING_SPLIT_LINE_CHARS, cjk))).toBeLessThanOrEqual(1)
    // …and the token figures reproduce upstream's own conversions: 20k ASCII chars
    // ≈ 7.3k tokens (100k ≈ 36k, their quoted comment), 20k CJK chars = 20k tokens.
    expect(ascii.tokens).toBe(Math.round(AUTHORING_SPLIT_LINE_CHARS / UPSTREAM_LIMIT_CHARS_PER_TOKEN))
    expect(cjk.tokens).toBe(AUTHORING_SPLIT_LINE_CHARS)
  })

  it('keeps the estimate range visibly separate from the judged token count', () => {
    const mixed = bodyCost('中'.repeat(1_000) + 'a'.repeat(3_000))
    expect(mixed.tokensLow).toBeLessThanOrEqual(mixed.tokens)
    expect(mixed.tokens).toBeLessThanOrEqual(mixed.tokensHigh + Math.round(1_000 * 0.4))
  })

  it('answers the normalized empty body as one code unit', () => {
    expect(bodyCost('')).toEqual({ chars: 1, cjk: 0, ascii: 1, tokens: 0, tokensLow: 0, tokensHigh: 0 })
  })
})
