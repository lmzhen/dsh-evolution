import { describe, expect, it } from 'vitest'
import { landedSettlements } from '../src/client/settle.ts'

describe('settings card write verdict', () => {
  it('reads a refused write on an already-overridden field as refused', () => {
    // The key IS present — the operator overrode this field earlier. A presence check
    // would call that a success and clear the draft the operator just typed.
    expect(landedSettlements([{ op: 'set', id: 'curatorIntervalHours', want: 999 }], { curatorIntervalHours: 170 })).toBe(false)
  })

  it('accepts a write whose requested value is now in the user layer', () => {
    expect(landedSettlements([{ op: 'set', id: 'curatorIntervalHours', want: 170 }], { curatorIntervalHours: 170 })).toBe(true)
  })

  it('refuses when there is no user layer at all', () => {
    expect(landedSettlements([{ op: 'set', id: 'curatorIntervalHours', want: 170 }], undefined)).toBe(false)
    expect(landedSettlements([{ op: 'set', id: 'curatorIntervalHours', want: 170 }], [170])).toBe(false)
  })

  it('refuses when the Host stored something other than what was requested', () => {
    expect(landedSettlements([{ op: 'set', id: 'curatorIntervalHours', want: 170 }], { curatorIntervalHours: 168 })).toBe(false)
    expect(landedSettlements([{ op: 'set', id: 'threatExemptLabels', want: 'a' }], { threatExemptLabels: ['a'] })).toBe(false)
  })

  it('compares container values structurally', () => {
    expect(landedSettlements([{ op: 'set', id: 'labels', want: ['a', 'b'] }], { labels: ['a', 'b'] })).toBe(true)
    expect(landedSettlements([{ op: 'set', id: 'labels', want: ['a', 'b'] }], { labels: ['b', 'a'] })).toBe(false)
  })

  it('settles several staged writes as one verdict', () => {
    expect(landedSettlements([{ op: 'set', id: 'a', want: 1 }, { op: 'set', id: 'b', want: true }], { a: 1, b: true })).toBe(true)
    expect(landedSettlements([{ op: 'set', id: 'a', want: 1 }, { op: 'set', id: 'b', want: true }], { a: 1 })).toBe(false)
  })

  it('accepts an empty batch', () => {
    expect(landedSettlements([], {})).toBe(true)
  })

  it('audit T5-05/A60: an unset landed only when the key is GONE from the user layer', () => {
    // The reset path had no verdict at all: the answer was dropped, so a host refusal changed
    // nothing on screen. An unset needs the OPPOSITE evidence from a set — absence, not a value.
    expect(landedSettlements([{ op: 'unset', id: 'curatorIntervalHours' }], {})).toBe(true)
    expect(landedSettlements([{ op: 'unset', id: 'curatorIntervalHours' }], { curatorIntervalHours: 170 })).toBe(false)
    expect(landedSettlements([{ op: 'unset', id: 'curatorIntervalHours' }], undefined)).toBe(true)
  })

  it('a batch holding both ops needs both kinds of evidence', () => {
    const batch = [{ op: 'set', id: 'a', want: 1 }, { op: 'unset', id: 'b' }] as const
    expect(landedSettlements(batch, { a: 1 })).toBe(true)
    expect(landedSettlements(batch, { a: 1, b: 2 })).toBe(false)
    expect(landedSettlements(batch, { b: 2 })).toBe(false)
  })
  it('audit T5-10: object key ORDER is not part of the value; array order is', () => {
    // The serialization comparison called { a: 1, b: 2 } and { b: 2, a: 1 } different values, so a
    // save that HAD landed read as refused (draft kept, error line shown) the moment a container
    // field appeared in the registry.
    expect(landedSettlements([{ op: 'set', id: 'x', want: { a: 1, b: 2 } }], { x: { b: 2, a: 1 } })).toBe(true)
    expect(landedSettlements([{ op: 'set', id: 'x', want: { a: 1, b: 2 } }], { x: { a: 1, b: 3 } })).toBe(false)
    expect(landedSettlements([{ op: 'set', id: 'x', want: { a: 1 } }], { x: { a: 1, b: 2 } })).toBe(false)
    expect(landedSettlements([{ op: 'set', id: 'x', want: [1, 2] }], { x: [2, 1] })).toBe(false)
    expect(landedSettlements([{ op: 'set', id: 'x', want: { a: [1, { b: 2 }] } }], { x: { a: [1, { b: 2 }] } })).toBe(true)
  })
})
