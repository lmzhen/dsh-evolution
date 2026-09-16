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

it('v28 G5.1 (REDACT-01): a block-style credential key masks the following indented value', () => {
  const block = ['api_key:', '  wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'region: us-east-1'].join('\n')
  const out = redactSecrets(block)
  expect(out).toContain('api_key:')
  expect(out).toContain('<redacted>')
  expect(out).not.toContain('wJalrXUtnFEMI')
  // Unrelated following lines are untouched.
  expect(out).toContain('region: us-east-1')
  // A bare key with nothing after it and NO indented value line stays as-is.
  expect(redactSecrets('notes:\n  plain prose line')).toBe('notes:\n  plain prose line')
})

it('S2.3 (PLAN 2026-09-16): a blank line between the block key and its value no longer abandons the pairing', () => {
  // The value is the first NON-EMPTY line after the key — the pass used to
  // look only at lines[i+1] and gave up when a blank line sat between them,
  // leaking the secret verbatim.
  const blankBetween = redactSecrets('api_key:\n\n  wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
  expect(blankBetween).toContain('api_key:')
  expect(blankBetween).toContain('<redacted>')
  expect(blankBetween).not.toContain('wJalrXUtnFEMI')
  // Multiple blank lines are skipped too, and the CRLF form pairs as well.
  expect(redactSecrets('password:\n\n\n    hunter2secretvalue')).toContain('<redacted>')
  expect(redactSecrets('api_key:\r\n\r\n  wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).not.toContain('wJalrXUtnFEMI')
})

it('S2.3: a DEDENTED line after the blank gap is the next key, not the value — it is never masked', () => {
  // `next: keep` is unindented: the scan stops there and leaves it alone.
  const next = redactSecrets('api_key:\n\nnext: keep')
  expect(next).toContain('api_key:')
  expect(next).toContain('next: keep')
  expect(next).not.toContain('<redacted>')
})

it('v28 G5.1 (REDACT-02): PEM private key blocks are masked whole', () => {
  const pem = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEpAIBAAKCAQEA7dKgXz0plusmorestuffthatgoesonandonandonforever',
    '-----END RSA PRIVATE KEY-----',
    'after the key',
  ].join('\n')
  const out = redactSecrets(pem)
  expect(out).toContain('<redacted-private-key>')
  expect(out).not.toContain('MIIEpAIBAAKCAQEA')
  expect(out).toContain('after the key')
  // OpenSSH variant too.
  const openssh = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----'
  expect(redactSecrets(openssh)).toContain('<redacted-private-key>')
})

it('v31 REDACT-03: block-style keys with connected prefixes (AWS_CLIENT_DB forms) are masked', () => {
  for (const key of ['AWS_SECRET_ACCESS_KEY:', 'aws_secret_access_key:', 'CLIENT_SECRET:', 'DB_PASSWORD:', 'MY_API_KEY:', 'SECRET:']) {
    const doc = `${key}\n    wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY`
    const out = redactSecrets(doc)
    expect(out, key).not.toContain('wJalrXUtnFEMI')
    expect(out, key).toContain('<redacted>')
  }
  // The inline prefixed form keeps working (A2-6 parity).
  expect(redactSecrets('x AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY')).not.toContain('wJalrXUtnFEMI')
  // A non-credential block key stays untouched.
  expect(redactSecrets('configuration:\n    plain value line')).toBe('configuration:\n    plain value line')
})

// OPT-03 (2026-09): the line-paired pass must behave identically on LF and
// CRLF text. The key-line pattern (`\s*$`) always absorbed the `\r`, but the
// value-line anchor (`[ \t]*$`) did not — on Windows-authored
// .env / compose / kubectl YAML the key matched, the value silently
// `continue`d, and the secret crossed to the review subagent verbatim.
it('OPT-03: CRLF block-style secrets are redacted exactly like LF ones', () => {
  const lf = 'aws_secret_access_key:\n    wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n'
  const crlf = 'aws_secret_access_key:\r\n    wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\r\n'
  expect(redactSecrets(lf)).not.toContain('wJalrXUtnFEMI')
  expect(redactSecrets(lf)).toContain('<redacted>')
  expect(redactSecrets(crlf)).not.toContain('wJalrXUtnFEMI')
  expect(redactSecrets(crlf)).toContain('<redacted>')
  // Arbitrary passphrases have no value-shape pattern — the block pass is
  // their only layer, so the CRLF path must cover them too.
  const passphraseCrlf = 'password:\r\n    hunter2-strength-phrase\r\n'
  expect(redactSecrets(passphraseCrlf)).not.toContain('hunter2-strength-phrase')
})

it('S0.3 (v37 P0-2): camelCase credential keys are masked like snake_case ones', () => {
  // A key that starts at a lower->upper hump, INCLUDING a keyword in the middle
  // of the identifier. Before S0.3 the left boundary required a word boundary or
  // a trailing separator, so every camelCase key crossed verbatim — even though
  // JSON is the carrier this module names as the common one.
  expect(redactSecrets('clientSecret: "s3cr3t-value-xyz"')).toBe('clientSecret: <redacted>')
  expect(redactSecrets('accessToken=abcdef1234567890')).toBe('accessToken=<redacted>')
  expect(redactSecrets('refreshToken: abcdef1234567890')).toBe('refreshToken: <redacted>')
  expect(redactSecrets('dbPassword: hunter2')).toBe('dbPassword: <redacted>')
  expect(redactSecrets('userPassword = hunter2')).toBe('userPassword = <redacted>')
  expect(redactSecrets('SecretAccessKey = wJalrXUtnFEMI')).toBe('SecretAccessKey = <redacted>')
  // JSON keeps the family's documented convention (the key's closing quote is
  // consumed with the separator — see the V27 G0.5 case above).
  expect(redactSecrets('{"SecretAccessKey":"wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY"}'))
    .toBe('{"SecretAccessKey":<redacted>')
  expect(redactSecrets('apiKey: abcdef1234567890')).toBe('apiKey: <redacted>')
  // Block style (a bare key line plus its indented value) gets the same treatment,
  // on LF and on CRLF input.
  expect(redactSecrets('clientSecret:\n  hunter2-value\nnext: keep')).toBe('clientSecret:\n  <redacted>\nnext: keep')
  // CRLF: the value line's `\r` is consumed with the value (same normalization
  // the OPT-03 case documents), so assert the secret is gone, not the bytes.
  const crlfBlock = redactSecrets('SecretAccessKey:\r\n  wJalrXUtnFEMI\r\nnext: keep')
  expect(crlfBlock).not.toContain('wJalrXUtnFEMI')
  expect(crlfBlock).toContain('<redacted>')
  expect(crlfBlock).toContain('next: keep')
})

it('S0.3 (v37 P0-2): the relaxation does not over-mask unrelated words', () => {
  // A lowercase continuation after the keyword is still not a key: the guard
  // must not degrade into "contains the word token/secret anywhere".
  expect(redactSecrets('tokenizer=abcdefghijklmnop')).toBe('tokenizer=abcdefghijklmnop')
  expect(redactSecrets('secretary: Jane Doe')).toBe('secretary: Jane Doe')
  expect(redactSecrets('passwordless: enabled')).toBe('passwordless: enabled')
  expect(redactSecrets('monkey=abcdefghijklmnop')).toBe('monkey=abcdefghijklmnop')
  expect(redactSecrets('compass=abcdefghijklmnop')).toBe('compass=abcdefghijklmnop')
  expect(redactSecrets('The TokenBudget was fine.')).toBe('The TokenBudget was fine.')
})

// PLAN S1.2 (2026-09-16): the candidate pass ran as String.replace, and for a
// key that failed CREDENTIAL_KEY_RE the callback returned the match untouched —
// but the greedy value group had already consumed the rest of the line, so
// every LATER key on that line was skipped by the g-flagged scan. The pass is
// the only layer that reaches a camelCase key, so `clientSecret` after a
// rejected `"name": ` (JSON) or `foo=bar ` (inline) crossed verbatim. It is
// now an exec loop that resumes a rejected match after lead+key+separator.
describe('PLAN S1.2: the candidate pass scans past a rejected key on the same line', () => {
  it('masks a camelCase credential key that FOLLOWS a rejected key (JSON and inline)', () => {
    expect(redactSecrets('{"name": "x", "clientSecret": "supersecret123"}'))
      .toBe('{"name": "x", "clientSecret": <redacted>')
    expect(redactSecrets('foo=bar clientSecret=supersecret123'))
      .toBe('foo=bar clientSecret=<redacted>')
    // A rejected value's non-credential `a:b` shape (a URL inside a JSON
    // value) still passes untouched — the resume point re-tests the value but
    // its "key" fails the same predicate (over-mask-don't-leak, not wholesale).
    expect(redactSecrets('{"url": "http://x", "clientSecret": "s3cr3t"}'))
      .toBe('{"url": "http://x", "clientSecret": <redacted>')
  })

  it('keeps the solo-key form and the S0.3 negative semantics unchanged', () => {
    // The solo form was already correct before the fix — it must not regress.
    expect(redactSecrets('{"clientSecret": "supersecret123"}')).toBe('{"clientSecret": <redacted>')
    // The `(?![a-z])` guard survives the rewritten pass: a lowercase
    // continuation after the keyword is still not a key.
    expect(redactSecrets('tokenizer=abc')).toBe('tokenizer=abc')
    expect(redactSecrets('secretary: abc')).toBe('secretary: abc')
    expect(redactSecrets('passwordless: abc')).toBe('passwordless: abc')
    // The earlier INLINE pass is untouched.
    expect(redactSecrets('password: hunter2')).toBe('password: <redacted>')
  })

  it('keeps processing later lines after a same-line repair (no cross-line state)', () => {
    const doc = '{"name": "x", "clientSecret": "supersecret123"}\npassword:\n    hunter2\nnext: keep'
    const out = redactSecrets(doc)
    expect(out).not.toContain('supersecret123')
    expect(out).not.toContain('hunter2')
    expect(out).toContain('clientSecret": <redacted>')
    expect(out).toContain('password:')
    expect(out).toContain('next: keep')
  })
})

it('P2-2 (v37): a key prefix past the old 64-char cap is still masked (64/65 boundary)', () => {
  // The A2-6 prefix bound leaked every longer key: 'A'*64+'_PASSWORD=hunter2'
  // was masked, the 65-char form crossed verbatim.
  const at64 = `${'A'.repeat(64)}_PASSWORD=hunter2`
  const at65 = `${'A'.repeat(65)}_PASSWORD=hunter2`
  expect(redactSecrets(at64)).toBe(`${'A'.repeat(64)}_PASSWORD=<redacted>`)
  expect(redactSecrets(at65)).toBe(`${'A'.repeat(65)}_PASSWORD=<redacted>`)
  expect(redactSecrets(at65)).not.toContain('hunter2')
  // The keyword-continuation cap (PASSWORD_<65 chars>=) and the camelCase key
  // cap ({1,80}) were the same defect class, one layer apart.
  expect(redactSecrets(`PASSWORD_${'B'.repeat(65)}=hunter2`)).toBe(`PASSWORD_${'B'.repeat(65)}=<redacted>`)
  const longCamel = `db${'x'.repeat(80)}Password: hunter2`
  expect(redactSecrets(longCamel)).toBe(`db${'x'.repeat(80)}Password: <redacted>`)
  // Block style (a bare key line plus its indented value) carries the same
  // connected-prefix group.
  const block = `${'C'.repeat(65)}_PASSWORD:\n    hunter2\n`
  expect(redactSecrets(block)).not.toContain('hunter2')
})

it('P2-2 (v37): the removed caps do not mask unrelated long keys and do not stall', () => {
  // The relaxed prefix must not degrade into "any long word before '=' is a key".
  const benign = `${'A'.repeat(65)}_value=plain text`
  expect(redactSecrets(benign)).toBe(benign)
  const benignWord = `${'A'.repeat(65)}monkey=abcdefghijklmnop`
  expect(redactSecrets(benignWord)).toBe(benignWord)
  // A 200k-char connected prefix: the mandatory left anchor keeps the scan
  // linear (the pre-A2-6 prefix shape took ~23-26s on 100k, and the old 64-char
  // cap leaked this input verbatim). `_` keeps the input out of the unrelated
  // URL pass, so this guard measures the prefix scan alone.
  const started = Date.now()
  const big = `${'_'.repeat(200_000)}PASSWORD=hunter2`
  expect(redactSecrets(big)).toBe(`${'_'.repeat(200_000)}PASSWORD=<redacted>`)
  expect(Date.now() - started).toBeLessThan(2000)
})
// PLAN S1.2 review B-P1 (2026-09-16): the candidate pass carried a consuming
// value group, so every rejected key re-scanned the rest of the line — one
// 160k-char single-line assignment chain cost ~2.1s (7.0s at 320k) against
// ~0.1ms for the replace form it replaced. The value end is now located by
// hand and the scan is linear.
describe('redact: candidate pass stays linear on one long line (S1.2 / B-P1)', () => {
  it('does not rescan the line remainder per rejected key', () => {
    const line = 'a:1 '.repeat(40_000)
    const started = Date.now()
    // No credential-shaped key here: the chain must come through untouched.
    expect(redactSecrets(line)).toBe(line)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
// P2-28 (v39): the URL-credentials pass used an unbounded scheme run, so a
// scheme-free blob (base64, minified JS, long token) retried the run at every
// offset — seconds per call on the outbound redaction path.
describe('redact: URL scheme bound (P2-28)', () => {
  it('masks only the password segment of a connection string', () => {
    expect(redactSecrets('postgres://app:s3cret@db.internal:5432/x')).toBe(
      'postgres://app:<redacted>@db.internal:5432/x',
    )
  })

  it('stays linear on a scheme-free 60k blob', () => {
    const started = Date.now()
    const blob = 'A1b2C3d4'.repeat(7500)
    expect(redactSecrets(blob)).toBe(blob)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
