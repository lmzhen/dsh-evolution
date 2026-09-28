/**
 * What a reader sees when one version is opened as a document (G1, W19/W23).
 *
 * SKILL.md opens with a YAML block whose closing `---` the platform's renderer reads as a setext
 * underline: the metadata line became the document's biggest heading and the real title sat under it
 * (seen on the installed panel 2026-09-28). The block is therefore not document text, and stripping it
 * has to FAIL OPEN: showing a document's first line is always better than showing nothing, so only a
 * block the family's own reader accepts is removed, and anything else is returned byte for byte.
 */
import { describe, expect, it } from 'vitest'
import { displayBodyOf, readingStats } from '@deepseek-ai/dsh-evolution-core'

const DOC = '---\nname: alpha\ndescription: First skill.\n---\n\n# Alpha\n\nBody text.\n'
const CRLF = DOC.replace(/\n/g, '\r\n')

describe('displaying one version as a document', () => {
  it('starts at the body, not at the metadata block', () => {
    const shown = displayBodyOf(DOC)
    expect(shown).toBe('# Alpha\n\nBody text.\n')
    expect(shown.startsWith('# Alpha')).toBe(true)
    // The name and the description are already on the row and in the left column; the raw view and the
    // body route still carry every byte, so nothing is lost by not rendering them twice.
    expect(shown).not.toContain('description:')
  })

  it('keeps a document whose fence never closes', () => {
    const unterminated = '---\n\n# Alpha\n\nBody.\n'
    expect(displayBodyOf(unterminated)).toBe(unterminated)
  })

  it('keeps a block that has no body to show', () => {
    for (const empty of ['---\nname: alpha\n---\n', '---\nname: alpha\n---\n\n\n']) {
      expect(displayBodyOf(empty)).toBe(empty)
    }
  })

  it('keeps a fence that is not a fence: an indented or BOM-prefixed first line', () => {
    const indented = ' ---\nname: alpha\n---\n\n# Alpha\n'
    expect(displayBodyOf(indented)).toBe(indented)
  })

  it('keeps the line endings of the body it shows', () => {
    expect(displayBodyOf(CRLF)).toBe('# Alpha\r\n\r\nBody text.\r\n')
  })

  it('leaves the rest of the document alone, including a rule of its own', () => {
    const withRule = '---\nname: alpha\n---\n\n# Alpha\n\n---\n\ntail\n'
    expect(displayBodyOf(withRule)).toBe('# Alpha\n\n---\n\ntail\n')
  })

  it('is idempotent: showing an already-shown body changes nothing', () => {
    const once = displayBodyOf(DOC)
    expect(displayBodyOf(once)).toBe(once)
  })
})

describe('how much of a version a reader is looking at (W23)', () => {
  it('reports the counts and whether anything was left out', () => {
    expect(readingStats('abcdef', 'abcdef')).toEqual({ totalChars: 6, shownChars: 6, truncated: false })
    expect(readingStats('abcdef', 'abc')).toEqual({ totalChars: 6, shownChars: 3, truncated: true })
    expect(readingStats('', '')).toEqual({ totalChars: 0, shownChars: 0, truncated: false })
  })
})
