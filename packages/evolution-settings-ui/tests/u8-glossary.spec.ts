// @tier fast
/**
 * U-8 (G5.9): one concept, one word — and no cross-face instructions in the GUI.
 *
 * The same state wore three names (chip "我改过", count "{n} 项已改", English "edited by you") while the
 * platform calls it "已覆盖 / Overridden"; and the refusal sentence told the reader to type a CLI command,
 * assuming they know which surface that lives on. The audit judges only what a READER sees: the
 * dictionary VALUES (keys themselves, and comments, are not copy).
 */
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/messages.ts'

/** Everything a reader can be shown, as one list. */
const copy = [...Object.values(zh), ...Object.values(en)]

describe('U-8: the family glossary', () => {
  it('names an overridden field with the platform\'s word, in both languages', () => {
    expect(zh.overridden).toBe('已覆盖')
    expect(en.overridden).toBe('Overridden')
    // The count is the same concept — same word, not a synonym.
    expect(zh.changed).toContain('已覆盖')
    expect(en.changed.toLowerCase()).toContain('overridden')
  })

  it('keeps cross-face instructions out of the copy', () => {
    const offenders = copy.filter(value => value.includes('dsh web') || value.includes('/evolution '))
    expect(offenders).toEqual([])
  })
})
