import { describe, expect, it } from 'vitest'
import { clampedNumber } from '../src/numeric.ts'

describe('clampedNumber', () => {
  it('passes through an in-range finite value unchanged', () => {
    expect(clampedNumber(120, 50, { min: 1 })).toBe(120)
    expect(clampedNumber(1, 50, { min: 1 })).toBe(1)
    expect(clampedNumber(2200, 2200, { min: 1 })).toBe(2200)
  })

  it('falls back to the default for 0 and negative when min >= 1 (G3.1: 0 is never a disabled meaning)', () => {
    expect(clampedNumber(0, 50, { min: 1 })).toBe(50)
    expect(clampedNumber(-1, 50, { min: 1 })).toBe(50)
    expect(clampedNumber(-0.5, 50, { min: 1 })).toBe(50)
  })

  it('falls back to the default for NaN and ±Infinity', () => {
    expect(clampedNumber(NaN, 50, { min: 1 })).toBe(50)
    expect(clampedNumber(Infinity, 50, { min: 1 })).toBe(50)
    expect(clampedNumber(-Infinity, 50, { min: 1 })).toBe(50)
  })

  it('falls back to the default for an absent or non-number value', () => {
    expect(clampedNumber(undefined, 50, { min: 1 })).toBe(50)
    expect(clampedNumber('12' as unknown as number, 50, { min: 1 })).toBe(50)
  })

  it('falls back to the default for a value above the max', () => {
    expect(clampedNumber(200, 50, { min: 1, max: 100 })).toBe(50)
    expect(clampedNumber(1.5, -0.25, { min: -1, max: 1 })).toBe(-0.25)
  })

  it('allows 0 and in-range values when min is 0 or negative (feedback threshold / zero-cost case)', () => {
    expect(clampedNumber(0, -0.25, { min: -1, max: 1 })).toBe(0)
    expect(clampedNumber(-0.5, -0.25, { min: -1, max: 1 })).toBe(-0.5)
    expect(clampedNumber(0, 0.001, { min: 0 })).toBe(0)
    expect(clampedNumber(0.25, -0.25, { min: -1, max: 1 })).toBe(0.25)
  })

  it('rejects an out-of-range value even when it is finite', () => {
    expect(clampedNumber(0, 10, { min: 5 })).toBe(10)
    expect(clampedNumber(-3, 10, { min: 5 })).toBe(10)
  })
})
