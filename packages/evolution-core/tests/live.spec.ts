// @tier pre-tag
import { describe, expect, it } from 'vitest'
import { clampOnce, liveBool, liveEnum, liveNumber, liveString, unwrapLive } from '../src/live.ts'

/** A stand-in for the platform's live reference (schema-parsed `.volatile()` field). */
const live = <T>(read: () => T | undefined): { get(): T | undefined } => ({ get: read })

describe('unwrapLive — the only place that decides live-vs-plain', () => {
  it('unwraps a live reference and re-reads it on every call (L2)', () => {
    let value: number | undefined = 3
    const ref = live(() => value)
    expect(unwrapLive<number>(ref)).toBe(3)
    value = 9
    expect(unwrapLive<number>(ref)).toBe(9)
  })

  it('returns a plain value unchanged, including undefined and a bare object (L1/L3)', () => {
    expect(unwrapLive<number>(3)).toBe(3)
    expect(unwrapLive<number>(undefined)).toBeUndefined()
    const policy = { mode: 'inject' }
    expect(unwrapLive(policy)).toBe(policy)
  })

  it('treats an object WITHOUT a callable get as a value, not a reference', () => {
    const withData = { get: 'not-a-function', mode: 'inject' }
    expect(unwrapLive(withData)).toBe(withData)
  })
})

describe('liveNumber — clamp, default, and warn once per key', () => {
  it('passes through a valid plain value and a valid live value (L1/L2)', () => {
    expect(liveNumber(3, 7, { min: 1 })).toBe(3)
    expect(liveNumber(live(() => 5), 7, { min: 1 })).toBe(5)
  })

  it('falls back when absent or illegal (L3/L4)', () => {
    expect(liveNumber(undefined, 7, { min: 1 })).toBe(7)
    expect(liveNumber(NaN, 7, { min: 1 })).toBe(7)
    expect(liveNumber(Infinity, 7, { min: 1 })).toBe(7)
    expect(liveNumber(-Infinity, 7, { min: 1 })).toBe(7)
    expect(liveNumber(0, 7, { min: 1 })).toBe(7)
    expect(liveNumber(11, 7, { min: 1, max: 10 })).toBe(7)
  })

  it('warns ONCE per key for an illegal value, and not at all for a legal one', () => {
    const warned = new Set<string>()
    const messages: string[] = []
    const opts = { min: 1, warned, warn: (message: string) => messages.push(message), name: 'knob' } as const
    expect(liveNumber(0, 7, opts)).toBe(7)
    expect(liveNumber(0, 7, opts)).toBe(7)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('knob provided an invalid value')
    expect(liveNumber(3, 7, opts)).toBe(3)
    expect(messages).toHaveLength(1)
  })
})

describe('clampOnce — the pre-0.22 adapter keeps its signature and behaviour', () => {
  it('reads a live reference, clamps, and warns once (same warning text as liveNumber)', () => {
    const warned = new Set<string>()
    const messages: string[] = []
    const value = { get: () => 0 as number | undefined }
    expect(clampOnce(warned, m => messages.push(m), 'pendingTtlMs', value, 120, 1)).toBe(120)
    expect(clampOnce(warned, m => messages.push(m), 'pendingTtlMs', value, 120, 1)).toBe(120)
    expect(messages).toEqual(['pendingTtlMs provided an invalid value; falling back to the default'])
    expect(clampOnce(warned, m => messages.push(m), 'pendingTtlMs', undefined, 120, 1)).toBe(120)
    expect(clampOnce(warned, m => messages.push(m), 'pendingTtlMs', 30, 120, 1, 600)).toBe(30)
  })
})

describe('liveBool / liveEnum / liveString — the tri-state readers (L5)', () => {
  it('reads booleans in all three shapes', () => {
    expect(liveBool(true)).toBe(true)
    expect(liveBool(live(() => false))).toBe(false)
    expect(liveBool(undefined)).toBe(false)
    expect(liveBool(undefined, true)).toBe(true)
  })

  it('accepts only a listed enum value', () => {
    const allowed = ['inject', 'review'] as const
    expect(liveEnum('review', allowed, 'inject')).toBe('review')
    expect(liveEnum(live(() => 'review' as const), allowed, 'inject')).toBe('review')
    expect(liveEnum('typo' as 'inject', allowed, 'inject')).toBe('inject')
    expect(liveEnum(undefined, allowed, 'inject')).toBe('inject')
  })

  it('treats a blank string as unset and trims a real one', () => {
    expect(liveString('  D:\\x  ', '/default')).toBe('D:\\x')
    expect(liveString('   ', '/default')).toBe('/default')
    expect(liveString(live(() => 'a'), '/default')).toBe('a')
    expect(liveString(undefined, '/default')).toBe('/default')
  })
})
