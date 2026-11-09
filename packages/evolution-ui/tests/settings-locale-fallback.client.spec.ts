// @tier fast
// @vitest-environment jsdom
/**
 * G5 C5: the bundle's fallback copy is the platform's FALLBACK_LOCALE (en), shared by every panel.
 * This helper IS that fallback path: the card copy arrives through the seat when it is mounted,
 * and through `message()` when it is not. An unspecified language must read English.
 */
import { describe, expect, it } from 'vitest'
import { en, message, zh } from '../src/panels/settings/messages.ts'

describe('the settings card copy falls back to the platform locale', () => {
  it('resolves an unspecified language to English, and still answers Chinese on request', () => {
    expect(message('changed')).toBe(en.changed)
    expect(message('changed')).not.toBe(zh.changed)
    expect(message('changed', 'zh')).toBe(zh.changed)
    expect(message('changed', 'en')).toBe(en.changed)
  })
})
