// @tier fast
import { describe, expect, it } from 'vitest'
import {
  SOFT_BODY_TOKENS,
  TEXT_BUDGETS,
  compareTextBudget,
  measureText,
} from '@deepseek-ai/dsh-evolution-core'

describe('text-budgets', () => {
  it('registers the four axes in one table', () => {
    expect(TEXT_BUDGETS.skillBodyHard).toMatchObject({ axis: 'storage', unit: 'codePoints', severity: 'hard' })
    expect(TEXT_BUDGETS.skillDescription).toMatchObject({ axis: 'display', unit: 'graphemes', severity: 'hard' })
    expect(TEXT_BUDGETS.bodySoft).toMatchObject({ axis: 'context', unit: 'tokens', severity: 'soft' })
  })

  it('derives the token budgets from the legacy character lines', () => {
    expect(TEXT_BUDGETS.bodySoft.limit).toBe(SOFT_BODY_TOKENS)
    expect(TEXT_BUDGETS.memory.limit).toBe(800)
    expect(TEXT_BUDGETS.user.limit).toBe(500)
  })

  it('compares display text by graphemes and counts the over edge', () => {
    expect(compareTextBudget('a'.repeat(60), TEXT_BUDGETS.skillDescriptionAuthoring)).toMatchObject({
      value: 60, over: false, remaining: 0,
    })
    expect(compareTextBudget('a'.repeat(61), TEXT_BUDGETS.skillDescriptionAuthoring)).toMatchObject({
      value: 61, over: true, remaining: -1,
    })
    expect(compareTextBudget('😀'.repeat(20), TEXT_BUDGETS.feedbackNote)).toMatchObject({ value: 20, over: false })
    expect(compareTextBudget('😀'.repeat(21), TEXT_BUDGETS.feedbackNote)).toMatchObject({ value: 21, over: true })
  })

  it('compares storage text by code points', () => {
    const budget = { ...TEXT_BUDGETS.skillName, limit: 4 }
    expect(compareTextBudget('中文ab', budget)).toMatchObject({ value: 4, over: false })
    expect(compareTextBudget('中文abc', budget)).toMatchObject({ value: 5, over: true })
  })

  it('uses the injected estimator only for token budgets', () => {
    const estimator = () => ({ value: 99, low: 1, high: 99, source: 'model' as const })
    expect(compareTextBudget('x', TEXT_BUDGETS.bodySoft, estimator)).toMatchObject({ value: 99, over: false })
    expect(measureText('x', estimator).tokens.value).toBe(99)
  })
})
