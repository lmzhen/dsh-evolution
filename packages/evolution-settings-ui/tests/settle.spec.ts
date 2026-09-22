import { describe, expect, it } from 'vitest'
import { landedWrites } from '../src/client/settle.ts'

describe('settings card save verdict', () => {
  it('reads a refused write on an already-overridden field as refused', () => {
    // The key IS present — the operator overrode this field earlier. A presence check
    // would call that a success and clear the draft the operator just typed.
    expect(landedWrites([{ id: 'curatorIntervalHours', want: 999 }], { curatorIntervalHours: 170 })).toBe(false)
  })

  it('accepts a write whose requested value is now in the user layer', () => {
    expect(landedWrites([{ id: 'curatorIntervalHours', want: 170 }], { curatorIntervalHours: 170 })).toBe(true)
  })

  it('refuses when there is no user layer at all', () => {
    expect(landedWrites([{ id: 'curatorIntervalHours', want: 170 }], undefined)).toBe(false)
    expect(landedWrites([{ id: 'curatorIntervalHours', want: 170 }], [170])).toBe(false)
  })

  it('refuses when the Host stored something other than what was requested', () => {
    expect(landedWrites([{ id: 'curatorIntervalHours', want: 170 }], { curatorIntervalHours: 168 })).toBe(false)
    expect(landedWrites([{ id: 'threatExemptLabels', want: 'a' }], { threatExemptLabels: ['a'] })).toBe(false)
  })

  it('compares container values structurally', () => {
    expect(landedWrites([{ id: 'labels', want: ['a', 'b'] }], { labels: ['a', 'b'] })).toBe(true)
    expect(landedWrites([{ id: 'labels', want: ['a', 'b'] }], { labels: ['b', 'a'] })).toBe(false)
  })

  it('settles several staged writes as one verdict', () => {
    expect(landedWrites([{ id: 'a', want: 1 }, { id: 'b', want: true }], { a: 1, b: true })).toBe(true)
    expect(landedWrites([{ id: 'a', want: 1 }, { id: 'b', want: true }], { a: 1 })).toBe(false)
  })

  it('accepts an empty batch', () => {
    expect(landedWrites([], {})).toBe(true)
  })
})
