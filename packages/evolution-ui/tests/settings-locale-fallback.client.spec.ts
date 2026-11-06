// @tier fast
// @vitest-environment jsdom
/**
 * G5 C5: the bundle's fallback copy is the platform's FALLBACK_LOCALE (zh), shared by every panel.
 * This helper IS that fallback path: the card copy arrives through the seat when it is mounted,
 * and through `message()` when it is not. An unspecified language must read Chinese.
 */
import { describe, expect, it } from 'vitest'
import { en, ja, message, zh } from '../src/panels/settings/messages.ts'

describe('the settings card copy falls back to the platform locale', () => {
  it('resolves an unspecified language to Chinese, and still answers English and Japanese on request', () => {
    expect(message('changed')).toBe(zh.changed)
    expect(message('changed')).not.toBe(en.changed)
    expect(message('changed', 'zh')).toBe(zh.changed)
    expect(message('changed', 'en')).toBe(en.changed)
    expect(message('changed', 'ja')).toBe(ja.changed)
  })
})
