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
    // P2-7 (v19): the value is the whole rest of the line — the quoted branch
    // no longer short-circuits, so the trailing text is masked with it.
    expect(redactSecrets('api_key: "ABCDEFGHIJKLMNOP" here')).toBe('api_key: <redacted>')
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

  it('V27 G0.5 (CB-1): masks QUOTED (JSON) credential assignments too', () => {
    // JSON is how credentials actually travel through tool results and session
    // text. The key's closing quote sat between the key and the separator, so
    // the separator never matched and the value crossed the session boundary
    // verbatim — an arbitrary passphrase has no value-shape pattern to fall
    // back on (`hunter2`, `topsecretvalue`).
    expect(redactSecrets('"password": "hunter2"')).toBe('"password": <redacted>')
    expect(redactSecrets('{"api_key":"topsecretvalue"}')).toBe('{"api_key":<redacted>')
    expect(redactSecrets('  "client_secret": "s3cr3t-value"  ')).toBe('  "client_secret": <redacted>')
    expect(redactSecrets('{"PASSWORD": "hunter2"}')).toBe('{"PASSWORD": <redacted>')
    // The plain (unquoted) forms keep working unchanged.
    expect(redactSecrets('password: hunter2')).toBe('password: <redacted>')
    expect(redactSecrets('api_key: sk-live-abcdefghijklmnop')).toBe('api_key: <redacted>')
    // A quoted JSON key whose value is a non-secret word is still masked only
    // on the credential keys (the key list is unchanged).
    expect(redactSecrets('{"user": "alice"}')).toBe('{"user": "alice"}')
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

describe('v22 (SEC-4): provider token shapes the original set missed', () => {
  it('masks npm / Stripe / GitHub fine-grained / Google keys and URL passwords', () => {
    expect(redactSecrets('npm_abcdefghij1234567890ABCD')).toBe('<redacted>')
    expect(redactSecrets('sk_live_abcdefghijklmnopqrst')).toBe('<redacted>')
    expect(redactSecrets('rk_live_abcdefghijklmnopqrst')).toBe('<redacted>')
    expect(redactSecrets('github_pat_11ABCDEF0123456789012345678901234')).toBe('<redacted>')
    expect(redactSecrets('AIzaSyA1234567890abcdefghijklmnopqrstuv')).toBe('<redacted>')
    // 连接串：只掩码口令段，scheme/user 保留可诊断。
    expect(redactSecrets('postgresql://admin:S3cr3t@host/db')).toBe('postgresql://admin:<redacted>@host/db')
  })

  it('masks the AWS secret key only on a line that already shows a redaction or aws/secret context', () => {
    // 配对行：AKIA 已被掩码，同行的 40 位 secret 不再残留（重组缺口）。
    const paired = redactSecrets('aws: AKIA1234567890ABCDEF / wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
    expect(paired).not.toContain('wJalrXUtnFEMI')
    expect(paired).toContain('aws:')
    // 无上下文的 40 位 base64ish 串（常见于普通文本）不脱敏。
    const benign = 'const hash = abcdefghij1234567890ABCDEFGHIJabcdefghij'
    expect(redactSecrets(benign)).toBe(benign)
  })
})
