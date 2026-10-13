import { describe, expect, it } from 'vitest'
import { contentHash } from '../src/mutations.ts'

describe('contentHash newline normalisation', () => {
  it('hashes LF and CRLF spellings of the same content identically', () => {
    const lf = '---\nname: a\n---\nBody of a.\n'
    expect(contentHash(lf.replaceAll('\n', '\r\n'))).toBe(contentHash(lf))
  })

  it('still separates genuinely different content', () => {
    expect(contentHash('a\n')).not.toBe(contentHash('a\n\n'))
  })
})
