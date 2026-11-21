// @tier fast
import { describe, expect, it } from 'vitest'
import { splitScheduledDebt } from '../src/index.ts'

describe('A7: review debt is consumed only for scheduled kinds', () => {
  it('splits both-scheduled debt', () => {
    const result = splitScheduledDebt({ memory: true, skill: true }, { memory: true, skill: true })
    expect(result).toEqual({ scheduled: { memory: true, skill: true } })
  })

  it('keeps the failed kind for retry and consumes the scheduled one', () => {
    const result = splitScheduledDebt({ memory: true, skill: true }, { memory: false, skill: true })
    expect(result).toEqual({ scheduled: { memory: false, skill: true }, failed: { memory: true, skill: false } })
  })

  it('returns no scheduled debt when every kind failed', () => {
    const result = splitScheduledDebt({ memory: true, skill: false }, { memory: false, skill: false })
    expect(result).toEqual({ failed: { memory: true, skill: false } })
  })
})
