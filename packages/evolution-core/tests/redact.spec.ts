import { describe, expect, it } from 'vitest'
import { redactSecrets } from '@deepseek-ai/dsh-evolution-core'

describe('redactSecrets (E-1, 0.3.16)', () => {
  it('replaces capture-group-free patterns with a literal <redacted> — no offset pollution', () => {
    // The seven secret patterns have NO capture groups, so the old replacer's
    // second callback argument was the match OFFSET (a number), and the output
    // became e.g. 'use 4<redacted> tomorrow'. The contract: secret body removed,
    // nothing else leaked.
    expect(redactSecrets('use sk-abcdefghij123456 tomorrow')).toBe('use <redacted> tomorrow')
    expect(redactSecrets('AKIA1234567890ABCDEF')).toBe('<redacted>')
    expect(redactSecrets('key ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456')).toBe('key <redacted>')
    expect(redactSecrets('glpat-abcdefghijklmnopqrst')).toBe('<redacted>')
    expect(redactSecrets('xoxb-123456789012-abcdefgh')).toBe('<redacted>')
    expect(redactSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF12345678')).toBe('<redacted>')
    expect(redactSecrets('Bearer abcdefghijklmnopqrstuv')).toBe('<redacted>')
  })

  it('keeps the inline-assignment prefix (its capture group is real)', () => {
    expect(redactSecrets('token=abc123456789012345')).toBe('token=<redacted>')
    expect(redactSecrets('api_key = abcdEFGH12345678')).toBe('api_key = <redacted>')
  })

  it('leaves plain prose untouched', () => {
    const prose = 'The administrator left a note about the pipeline deadline.'
    expect(redactSecrets(prose)).toBe(prose)
  })

  it('is idempotent', () => {
    expect(redactSecrets(redactSecrets('use sk-abcdefghij123456 tomorrow'))).toBe('use <redacted> tomorrow')
  })
})
