// @tier fast
import { describe, expect, it } from 'vitest'
import {
  codePointCount,
  conservativeTokenEstimator,
  graphemeCount,
  measureText,
  measureUnit,
  truncateGraphemes,
  utf8ByteLength,
} from '@deepseek-ai/dsh-evolution-core'

describe('text-metrics', () => {
  it('measures ASCII on all four units', () => {
    const metrics = measureText('a'.repeat(100))
    expect(metrics).toMatchObject({ utf8Bytes: 100, codePoints: 100, graphemes: 100 })
    expect(metrics.tokens).toEqual({ value: 34, low: 25, high: 34, source: 'unicode-heuristic' })
  })

  it('measures CJK by bytes and code points, not UTF-16 quirks', () => {
    const metrics = measureText('中'.repeat(10))
    expect(metrics).toMatchObject({ utf8Bytes: 30, codePoints: 10, graphemes: 10 })
    expect(metrics.tokens).toEqual({ value: 10, low: 3, high: 10, source: 'unicode-heuristic' })
  })

  it('keeps emoji and combining sequences as one grapheme', () => {
    expect(measureText('😀')).toMatchObject({ utf8Bytes: 4, codePoints: 1, graphemes: 1 })
    expect(measureText('e\u0301')).toMatchObject({ utf8Bytes: 3, codePoints: 2, graphemes: 1 })
    expect(graphemeCount('👨‍👩‍👧‍👦')).toBe(1)
  })

  it('measures a mixed script without a per-language table', () => {
    const metrics = measureText('中文abcd')
    expect(metrics).toMatchObject({ utf8Bytes: 10, codePoints: 6, graphemes: 6 })
    expect(metrics.tokens).toEqual({ value: 4, low: 2, high: 4, source: 'unicode-heuristic' })
  })

  it('keeps the token range visible and conservative', () => {
    const estimate = conservativeTokenEstimator('中文abcd')
    expect(estimate.low).toBeLessThanOrEqual(estimate.value)
    expect(estimate.high).toBeGreaterThanOrEqual(estimate.value)
    expect(estimate.value).toBe(estimate.high)
  })

  it('answers an empty string as all zero', () => {
    expect(measureText('')).toMatchObject({ utf8Bytes: 0, codePoints: 0, graphemes: 0 })
    expect(measureText('').tokens).toEqual({ value: 0, low: 0, high: 0, source: 'unicode-heuristic' })
  })

  it('accepts an injected token estimator without changing the other units', () => {
    const metrics = measureText('abc', () => ({ value: 42, low: 1, high: 42, source: 'model' }))
    expect(metrics.utf8Bytes).toBe(3)
    expect(metrics.codePoints).toBe(3)
    expect(metrics.tokens).toEqual({ value: 42, low: 1, high: 42, source: 'model' })
  })

  it('reads one unit without a caller-owned length expression', () => {
    expect(measureUnit('中文', 'utf8Bytes')).toBe(6)
    expect(measureUnit('中文', 'codePoints')).toBe(2)
    expect(measureUnit('中文', 'graphemes')).toBe(2)
    expect(measureUnit('中文', 'tokens')).toBe(2)
  })

  it('counts code points and bytes independently', () => {
    expect(codePointCount('😀')).toBe(1)
    expect(utf8ByteLength('😀')).toBe(4)
    expect(utf8ByteLength('中')).toBe(3)
  })

  it('truncates grapheme-safely and counts the ellipsis inside the budget', () => {
    expect(truncateGraphemes('abcdef', 4)).toBe('abc…')
    expect(truncateGraphemes('abcdef', 1)).toBe('…')
    expect(truncateGraphemes('abcdef', 0)).toBe('')
    expect(truncateGraphemes('😀😃😄', 2)).toBe('😀…')
    expect(truncateGraphemes('😀😃😄', 3)).toBe('😀😃😄')
    expect(truncateGraphemes('abcdef', 2, '..')).toBe('..')
  })
})
