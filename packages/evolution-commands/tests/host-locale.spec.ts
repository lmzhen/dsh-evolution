// @tier fast
import { describe, expect, it } from 'vitest'
import { hostCommandText, hostErrorText, resolveHostLocale } from '../src/host-locale.ts'

function ctxFor(preference: unknown): never {
  return {
    get: (name: string) => name === 'settings'
      ? { describe: () => [{ ns: 'locale', value: preference === undefined ? {} : { preference } }] }
      : undefined,
  } as never
}

describe('host human locale', () => {
  it('follows an explicit supported preference', () => {
    expect(resolveHostLocale(ctxFor('ja'))).toBe('ja')
    expect(resolveHostLocale(ctxFor('ru'))).toBe('ru')
  })

  it('keeps Chinese without a preference and falls back to English for an unknown one', () => {
    expect(resolveHostLocale(ctxFor(undefined))).toBe('zh')
    expect(resolveHostLocale(ctxFor('it'))).toBe('en')
  })

  it('renders localized command help', () => {
    expect(hostCommandText('ja', 'summary.pending')).toContain('承認待ち')
    expect(hostCommandText('ja', 'summary.pending')).toContain('--detail')
  })

  it('renders the localized error with stable code and slots', () => {
    const text = hostErrorText('ja', 'e-324-restricted-preset-unavailable', { a1: '原因' })
    expect(text).toContain('E-324')
    expect(text).toContain('原因')
    expect(text).not.toContain('%a1%')
  })
})
