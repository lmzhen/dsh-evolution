// @tier fast
import { describe, expect, it } from 'vitest'
import {
  hostLocale,
  installHostLocale,
  localeFromSettings,
  registerHostMessages,
  tr,
  trIn,
} from '../src/messages.ts'

describe('host message catalog', () => {
  it('returns the authored source when nothing is translated', () => {
    expect(trIn('zh', '未译「{name}」', { name: 'x' })).toBe('未译「x」')
    expect(trIn('en', '未译「{name}」', { name: 'x' })).toBe('未译「x」')
    expect(trIn('ja', '未译「{name}」', { name: 'x' })).toBe('未译「x」')
  })

  it('resolves ja → en → source and fills {slot} values', () => {
    const source = '仅测试：源「{name}」'
    const dispose = registerHostMessages({
      en: { [source]: 'test only: source {name}' },
      ja: { [source]: 'テスト専用：ソース {name}' },
    })
    try {
      expect(trIn('ja', source, { name: 'x' })).toBe('テスト専用：ソース x')
      expect(trIn('en', source, { name: 'x' })).toBe('test only: source x')
      expect(trIn('zh', source, { name: 'x' })).toBe('仅测试：源「x」')
      // A missing ja value falls through to the English twin, then to the source.
      const half = '仅测试：片「{name}」'
      const disposeHalf = registerHostMessages({ en: { [half]: 'test only: half {name}' } })
      try {
        expect(trIn('ja', half, { name: 'y' })).toBe('test only: half y')
      } finally {
        disposeHalf()
      }
    } finally {
      dispose()
    }
  })

  it('follows the installed provider and returns to zh after detaching', () => {
    const source = '仅测试：提供者「{name}」'
    const disposeTable = registerHostMessages({
      en: { [source]: 'provider: {name}' },
      ja: { [source]: 'プロバイダ: {name}' },
    })
    const release = installHostLocale(() => 'ja')
    try {
      expect(hostLocale()).toBe('ja')
      expect(tr(source, { name: 'z' })).toBe('プロバイダ: z')
    } finally {
      release()
      disposeTable()
    }
    expect(hostLocale()).toBe('zh')
    expect(tr(source, { name: 'z' })).toBe('仅测试：提供者「z」')
  })

  it('reads the platform locale preference from the settings descriptor', () => {
    const reader = (preference: unknown) => ({
      get: () => ({ describe: () => [{ ns: 'locale', user: preference === undefined ? {} : { preference } }] }),
    })
    expect(localeFromSettings(reader('ja'))).toBe('ja')
    expect(localeFromSettings(reader('en'))).toBe('en')
    expect(localeFromSettings(reader('zh'))).toBe('zh')
    expect(localeFromSettings(reader(undefined))).toBe('zh')
    expect(localeFromSettings({ get: () => undefined })).toBe('zh')
  })

  it('leaves an unknown slot standing instead of printing undefined', () => {
    expect(trIn('zh', '值：{known}/{missing}', { known: 1 })).toBe('值：1/{missing}')
  })
})
