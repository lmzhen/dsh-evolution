import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionCapability from '../src/index.ts'

const FIELDS = ['maxNameLength', 'maxPurposeLength', 'maxCodeChars'] as const

describe('evolution-capability G3.1 numeric clamping', () => {
  const parse = (input: unknown): unknown => (EvolutionCapability.Config as unknown as (i: unknown) => unknown)(input)

  it('schema rejects 0/negative but lets NaN/Infinity through (.min(1))', () => {
    for (const field of FIELDS) {
      expect(() => parse({ [field]: 0 }), `${field} 0`).toThrow()
      expect(() => parse({ [field]: -1 }), `${field} -1`).toThrow()
    }
    const nan = parse({ maxNameLength: NaN }) as { maxNameLength: number }
    expect(Number.isNaN(nan.maxNameLength)).toBe(true)
    const inf = parse({ maxCodeChars: Infinity }) as { maxCodeChars: number }
    expect(inf.maxCodeChars).toBe(Infinity)
  })

  it('assembly clamps every invalid limit to the default and preserves in-range values', () => {
    // Direct construction bypasses the schema, so 0/-1/NaN are exactly the
    // values the assembly clamp must correct.
    const bad = new EvolutionCapability(new Context(), { maxNameLength: 0, maxPurposeLength: -1, maxCodeChars: NaN })
    // A 64-char name (== default maxNameLength) passes; an un-clamped 0 limit
    // would reject it.
    expect(bad.validate({ name: 'a'.repeat(64), purpose: 'purpose', code: { host: 'x' } }).ok).toBe(true)

    const ok = new EvolutionCapability(new Context(), { maxNameLength: 40, maxPurposeLength: 80, maxCodeChars: 1000 })
    expect(ok.validate({ name: 'a'.repeat(41), purpose: 'purpose', code: { host: 'x' } }).ok).toBe(false)
    expect(ok.validate({ name: 'a'.repeat(40), purpose: 'purpose', code: { host: 'x' } }).ok).toBe(true)
  })
})
