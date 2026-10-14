// @tier fast
/**
 * G5 C4: ONE filler for the settings half. The rule used to be written at seven call sites
 * (`t('changed').replace('{n}', …)`); it now lives in `fill`/`formatText`, and these two properties
 * are the ones a caller depends on: a supplied slot is substituted, an UNKNOWN one is left standing.
 */
import { describe, expect, it } from 'vitest'
import { en, fill, formatText } from '../src/client/messages.ts'

describe('the single slot filler (G5 C4)', () => {
  it('substitutes every supplied slot', () => {
    expect(fill('{n} changed', { n: 3 })).toBe('3 changed')
    expect(fill('{a} of {b}', { a: 1, b: 2 })).toBe('1 of 2')
  })

  it('leaves an unknown slot standing instead of printing undefined', () => {
    expect(fill('{n} changed', {})).toBe('{n} changed')
    expect(fill('{n} of {total}', { n: 1 })).toBe('1 of {total}')
  })

  it('answers the resolved copy through formatText, the spec-side twin of the seat translator', () => {
    expect(formatText('changed', { n: 3 })).toBe(en.changed.replace('{n}', '3'))
    expect(formatText('changed')).toBe(en.changed)
  })
})
