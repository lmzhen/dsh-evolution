import { describe, expect, it } from 'vitest'
import { AUTHORING_SPLIT_LINE_CHARS, bodyCost, COST_ASCII_TOKEN_HIGH, COST_ASCII_TOKEN_LOW, COST_CJK_TOKEN_HIGH, COST_CJK_TOKEN_LOW, COST_ASCII_WEIGHT, DEFAULT_HEALTH_THRESHOLDS } from '@deepseek-ai/dsh-evolution-core'

// Every expectation is stated on the ON-DISK form: the accounting basis appends
// one trailing newline, the same measure `maxSkillContentChars` bounds.
describe('bodyCost (design §5.2)', () => {
  it('weighs a CJK body one unit per code unit', () => {
    const cost = bodyCost('中'.repeat(10))
    expect(cost).toMatchObject({ chars: 11, cjk: 10, ascii: 1, units: 10 })
    expect(cost.tokensLow).toBe(Math.round(10 * COST_CJK_TOKEN_LOW + COST_ASCII_TOKEN_LOW))
    expect(cost.tokensHigh).toBe(Math.round(10 * COST_CJK_TOKEN_HIGH + COST_ASCII_TOKEN_HIGH))
  })

  it('weighs a latin body a quarter unit per code unit', () => {
    const cost = bodyCost('a'.repeat(100))
    expect(cost).toMatchObject({ chars: 101, cjk: 0, ascii: 101, units: 25 })
    expect(cost.tokensLow).toBe(Math.round(101 * COST_ASCII_TOKEN_LOW))
    expect(cost.tokensHigh).toBe(Math.round(101 * COST_ASCII_TOKEN_HIGH))
  })

  it('adds the two scripts for a mixed body', () => {
    expect(bodyCost('中文abcd')).toMatchObject({ chars: 7, cjk: 2, ascii: 5, units: 3 })
  })

  it('accounts on the ON-DISK form, so trailing whitespace cannot change the number', () => {
    const base = '中'.repeat(50) + 'a'.repeat(50)
    expect(bodyCost(base)).toEqual(bodyCost(base + '\n\n  '))
  })

  it('derives the authoring band from the upstream split line, NOT from the char ceiling (V3)', () => {
    // One conversion, one source: the band is the authoring standard's split line
    // (20k characters upstream) at the ASCII weight.
    expect(DEFAULT_HEALTH_THRESHOLDS.softBodyCostUnits).toBe(Math.round(AUTHORING_SPLIT_LINE_CHARS * COST_ASCII_WEIGHT))
    // The point of the change: a deployment-tunable ceiling must not move the
    // discipline band with it — that coupling is how a 40k ceiling hid a 99k body.
    const ceilingDerived = Math.round(DEFAULT_HEALTH_THRESHOLDS.softBodyChars * COST_ASCII_WEIGHT)
    expect(DEFAULT_HEALTH_THRESHOLDS.softBodyCostUnits).toBeLessThan(ceilingDerived)
  })

  it('shows a CJK body costing several times the authoring band at the same char count', () => {
    const cjk = bodyCost('中'.repeat(DEFAULT_HEALTH_THRESHOLDS.softBodyChars))
    expect(cjk.chars).toBeGreaterThanOrEqual(DEFAULT_HEALTH_THRESHOLDS.softBodyChars)
    expect(cjk.units).toBeGreaterThan(2 * DEFAULT_HEALTH_THRESHOLDS.softBodyCostUnits)
  })

  it('answers the normalized empty body as one code unit', () => {
    expect(bodyCost('')).toEqual({ chars: 1, cjk: 0, ascii: 1, units: 0, tokensLow: 0, tokensHigh: 0 })
  })
})
