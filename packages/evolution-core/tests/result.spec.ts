// @tier fast
import { describe, expect, it } from 'vitest'
import { err, familyError, isErr, isOk, ok, unwrapOr } from '../src/result.ts'

describe('Result vocabulary', () => {
  it('narrows ok and err', () => {
    const good = ok(7)
    const bad = err({ code: 'E-301', message: 'no' })
    expect(isOk(good)).toBe(true)
    expect(isErr(good)).toBe(false)
    expect(isErr(bad)).toBe(true)
    expect(unwrapOr(good, 0)).toBe(7)
    expect(unwrapOr(bad, 0)).toBe(0)
  })

  it('coerces caught values and keeps the cause', () => {
    const cause = new Error('boom')
    expect(familyError('E-303', cause)).toEqual({ code: 'E-303', message: 'boom', cause })
    expect(familyError('E-302', 'plain')).toEqual({ code: 'E-302', message: 'plain', cause: 'plain' })
  })
})


