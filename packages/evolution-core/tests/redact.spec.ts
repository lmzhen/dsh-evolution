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

  it('F-335: masks connected keys and case/whitespace bearer variants', () => {
    // Connected keys (underscore/hyphen prefix or suffix) now match.
    expect(redactSecrets('auth_token=abcdefghijklmnop')).toBe('auth_token=<redacted>')
    expect(redactSecrets('client_secret=abcdefghijklmnop')).toBe('client_secret=<redacted>')
    expect(redactSecrets('access_token=abcdefghijklmnop')).toBe('access_token=<redacted>')
    expect(redactSecrets('token_id=abcdefghijklmnop')).toBe('token_id=<redacted>')
    // Bearer is case-insensitive and tolerates tab / multiple spaces.
    expect(redactSecrets('bearer abcdefghijklmnopqrstuv')).toBe('<redacted>')
    expect(redactSecrets('Authorization: Bearer\tabcdefghijklmnopqrstuv')).toBe('Authorization: <redacted>')
  })

  it('F-335: a bare core-word substring is not a key (monkey= stays)', () => {
    // `monkey` contains "key" but no `_`/`-` separator, so it must NOT be masked.
    expect(redactSecrets('monkey=abcdefghijklmnop')).toBe('monkey=abcdefghijklmnop')
    expect(redactSecrets('The monkey=abcdefghijklmnop was loud')).toBe('The monkey=abcdefghijklmnop was loud')
  })

  it('leaves plain prose untouched', () => {
    const prose = 'The administrator left a note about the pipeline deadline.'
    expect(redactSecrets(prose)).toBe(prose)
  })

  it('A2-5 (v18): masks the whole value, including a value with no closing quote', () => {
    // The quoted branch consumes the quotes with the value (the label and the
    // separator survive), so no partial secret remains on the line.
    expect(redactSecrets('api_key: "ABCDEFGHIJKLMNOP" here')).toBe('api_key: <redacted> here')
    // An opening quote with no closing quote on this line — a truncated log
    // line or a multi-line value — must fall back to the unquoted branch and
    // mask to the line end. The v18 audit's first cut excluded `"` from that
    // branch, so no branch matched and the regex masked only the separator's
    // trailing space, leaking the secret verbatim.
    expect(redactSecrets('api_key: "ABCDEFGHIJKLMNOP')).toBe('api_key: <redacted>')
    expect(redactSecrets('token: abc"defghijklmnop')).toBe('token: <redacted>')
    // A2-5: characters the old value class excluded (spaces, @, #) are covered.
    expect(redactSecrets('password=p@ss w0rd! #x')).toBe('password=<redacted>')
  })

  it('is idempotent', () => {
    expect(redactSecrets(redactSecrets('use sk-abcdefghij123456 tomorrow'))).toBe('use <redacted> tomorrow')
  })

  it('V8-12: sk-only patterns carry a word boundary (task-/risk- words are not keys)', () => {
    // `sk-` alone used to match inside `task-…`/`risk-…` identifiers — an
    // identifier ending in `sk-` plus a ≥16-char suffix was masked wholesale.
    expect(redactSecrets('task-2024010112345678')).toBe('task-2024010112345678')
    expect(redactSecrets('risk-abcdef0123456789')).toBe('risk-abcdef0123456789')
    // The real shape still redacts.
    expect(redactSecrets('use sk-abcdefghij123456 tomorrow')).toBe('use <redacted> tomorrow')
  })
})
