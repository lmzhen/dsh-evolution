/**
 * Credential-shaped text redaction for cross-boundary model inputs (011 §8).
 *
 * The maintenance facts block and probe output — like the review snapshot
 * before them — leave the owning session's context, so secret-shaped text is
 * masked before it is sent. Best-effort and conservative: targets well-known
 * secret shapes and inline assignment patterns, never wholesale content.
 * Migrated from `evolution-review` so both channels share one implementation.
 */

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  // V8-12 (0.3.47): `\b` left boundary — `sk-` alone matched inside
  // `task-…`/`risk-…` words. V9-10 (0.3.51): the "other patterns carry their
  // own anchors" claim was overstated — AKIA/ghp_/glpat-/xox do carry a
  // fixed prefix, but the JWT (`eyJ…`) and bearer rows have no left boundary
  // at all (a `…xeyJ…` substring would redact mid-word). Deliberate: JWT
  // body shapes never legitimately appear inside another word, and the
  // bearer row's initial-cap `Bearer` form makes mid-word hits effectively
  // nonexistent. Revisit only if a real false positive shows up.
  ['openai-style key', /\bsk-[A-Za-z0-9_-]{16,}/g],
  ['aws access key', /AKIA[0-9A-Z]{16}/g],
  ['github token', /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ['gitlab token', /glpat-[A-Za-z0-9_-]{16,}/g],
  ['slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  // v22 (SEC-4): provider token shapes the original set missed (each verified
  // to pass redactSecrets verbatim before this change).
  ['npm token', /npm_[A-Za-z0-9]{20,}/g],
  ['stripe key', /[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['github fine-grained token', /github_pat_[A-Za-z0-9_]{20,}/g],
  ['google api key', /AIza[0-9A-Za-z_-]{30,}/g],
  // F-335 (0.3.23): case-insensitive (`bearer`), and `\s+` so a tab or run of
  // spaces between `Bearer` and the token is still masked (`Bearer\t...`).
  ['bearer credential', /Bearer[\s]+[a-z0-9._~+/=\-]{16,}/gi],
]

// F-335 (0.3.23): the older `\b(?:token|...)\b` missed connected keys such as
// `auth_token=`, `client_secret=`, `access_token=`. The v18 audit (A2-5)
// found the replacement's value class too narrow: a value containing
// `@ ! # $ %` or spaces did not match at all and leaked verbatim. The pattern
// now matches the key + separator, then ANY quoted or unquoted value up to
// the line end, and masks the value wholesale.
//
// The unquoted fallback must NOT exclude the quote characters: a value whose
// opening quote has no closing quote on this line (a truncated log line, a
// multi-line JSON value, an escaped quote inside the value) otherwise matched
// no branch at all, and the regex fell back to "value = one space" — masking
// the separator and leaking the secret verbatim. The quoted branches still win
// for well-formed values because they are tried first.
//
// A2-6 (v18): the old `(?:\b|[\w-]+[_\-])` prefix was O(n²) on a long word
// with no separator (100k chars measured ~23-26s, synchronously). P2-2 (v37):
// the `{0,64}` bound added then is GONE — a 65-char key prefix crossed
// verbatim. Linearity now rests on the mandatory left anchor `(^|[^\w-])`:
// only a key run behind `^`/a non-word char is attempted, and once per run.
// P2-7/P2-8 (v19): the value is the WHOLE rest of the line — one branch, no
// quoted/unquoted alternation. Two defects forced this: the separator's `[\s]*`
// matched a newline, so `api_key:` with no same-line value swallowed the NEXT
// line; and the quoted branch short-circuited at the first inner quote, leaving
// `token="a"b"c" tail` as `token=<redacted>b"c" tail`. Over-masking a line is
// acceptable for a redactor; leaking or eating an unrelated line is not.
// Capture groups: 1 = leading boundary (kept), 2 = connected prefix (kept),
// 3 = key (kept), 4 = separator (kept), 5 = value (masked).
// V27 G0.5 (CB-1): group 4 tolerates a CLOSING QUOTE after the key. In JSON —
// the most common carrier of credentials in tool results and session text —
// the key is quoted (`"password": "hunter2"`), and the quote between the key
// and the `:` made the separator miss entirely, so the whole pattern failed and
// the value crossed the boundary verbatim. Value-shape patterns only masked
// well-known token prefixes; an arbitrary passphrase like `hunter2` had no
// layer left to catch it.
const INLINE_ASSIGNMENT_PATTERN = new RegExp(
  '(^|[^\\w-])([\\w-]*[_\\-])?((?:token|api[_-]?key|secret|password|passwd)' +
  '(?:[_\\-][\\w-]*)?)\\b(["\\\']?[\\t ]*[:=][\\t ]*)' +
  '([^\\r\\n]+)',
  'gi',
)

// v22 (SEC-4): a scheme://user:password@host URL — only the password segment
// is masked; the group-preserving replace keeps the scheme/user readable so a
// connection string stays diagnosable.
// P2-28 (v39): the scheme run is capped at 64 characters — unbounded, a
// scheme-free 60k blob cost 2.1-4.4s per call (the engine re-walks the run at
// every offset, synchronously, on the outbound redaction path); 25ms now.
const URL_CREDENTIALS_PATTERN = /([a-z][a-z0-9+.-]{0,63}:\/\/[^\s:/@]+:)([^\s/@]+)@/gi

// v28 G5.1 (REDACT-02): a PEM private key block is masked WHOLE (header to
// footer). threats.ts blocks the same shape on the WRITE path
// (`private_key_block`, SEC-3) — but the review/maintenance OUTBOUND channels
// pass through redact only, never the threat scan, so a session that pasted a
// key used to ship it verbatim to the second model context. The header
// alternation mirrors threats.ts's pattern (keep the two in sync).
// The `\\s` doubles are required: these are STRING literals feeding
// `new RegExp`, so each backslash must survive JS string-escape processing.
const PEM_HEAD = '-----BEGIN\\s+(?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED|PGP)\\s+)?PRIVATE\\s+KEY(?:\\s+BLOCK)?-----'
const PEM_TAIL = '-----END\\s+(?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED|PGP)\\s+)?PRIVATE\\s+KEY(?:\\s+BLOCK)?-----'
const PEM_PRIVATE_KEY_PATTERN = new RegExp(`${PEM_HEAD}[\\s\\S]*?${PEM_TAIL}`, 'g')

// v28 G5.1 (REDACT-01): the block-style form the inline pattern cannot reach —
// its separator `[\t ]*[:=]` and value class are same-line-only, so YAML /
// docker-compose / kubectl-secret style
//   api_key:
//     wJalrXUtnFEMI…
// crossed verbatim. This predicate matches a line that is ONLY a credential
// key plus its mapping separator; the following INDENTED line is its value.
// v31 REDACT-03: the key carries the same connected-prefix group as the
// inline pattern (`AWS_SECRET_ACCESS_KEY`, `CLIENT_SECRET`, `DB_PASSWORD` —
// the inline pattern's connected-prefix form, unbounded since P2-2 (v37)).
// Without it, every prefixed block key
// missed the pass AND the AWS residual sweep (the underscore blocks every
// `\b`), so the secret shipped verbatim (executed-verified leak).
// v31 REDACT-03: the key carries the same connected-prefix group as the
// inline pattern (`AWS_SECRET_ACCESS_KEY`, `CLIENT_SECRET`, `DB_PASSWORD` —
// the inline pattern's connected-prefix form, unbounded since P2-2 (v37)).
// Without it, every prefixed block key
// missed the pass AND the AWS residual sweep (the underscore blocks every
// `\b`), so the secret shipped verbatim (executed-verified leak).
// OPT-03 (2026-09): the trailing `\s*$` already absorbed a `\r` on the KEY
// line, but the VALUE-line pattern below still anchored `[ \t]*$` — on CRLF
// text the key line matched, the value line silently `continue`d, and the
// secret crossed verbatim. Both anchors now tolerate an optional `\r` so the
// line-paired pass behaves identically on LF and CRLF input (Windows-authored
// .env / compose / kubectl YAML is the realistic carrier).
const BLOCK_KEY_ONLY_LINE = /(?:^|\s)([\w-]*[_\-])?((?:token|api[_-]?key|secret|password|passwd)(?:[_\-][\w-]*)?)\s*:(?:\r)?$/i

// S0.3 (v37 P0-2): the two patterns above cannot express a camelCase hump —
// they are case-INSENSITIVE, so [A-Z] would match lowercase too. This pair
// decides by a case-insensitive KEYWORD test that rejects a lowercase
// continuation: clientSecret= / accessToken= / SecretAccessKey= are masked,
// while tokenizer= / secretary: / passwordless: stay untouched.
const CREDENTIAL_KEY_RE = /(?:[Tt]oken|[Ss]ecret|[Pp]assword|[Pp]asswd|[Aa]pi[_-]?[Kk]ey)(?![a-z])/
// P2-2 (v37): the candidate key carried the same defect class in `{1,80}` form —
// a longer camelCase key (this pass is the ONLY layer that can reach one) was
// skipped wholesale. The cap is gone; the scan stays linear (see A2-6 above).
// Review B-P1 (2026-09-16): the former fourth group was a CONSUMING
// `([^\r\n]+)` value. Every match then cost O(distance to end of line), so one
// long single-line input (minified JSON / a dense assignment chain) went
// quadratic in the line length — 2.1s for 160k chars and 7.0s for 320k against
// ~0.1ms for the replace form this loop replaced. The zero-width lookahead
// keeps the old "a value must exist" requirement (an empty `token=` still does
// not match) and the loop locates the value end by hand, which stays linear.
const CANDIDATE_ASSIGNMENT_PATTERN = /(^|[^\w-])([\w-]+)(["']?[\t ]*[:=][\t ]*)(?=[^\r\n])/g

/**
 * Mask credential-shaped text before it crosses a session boundary.
 * @param text - the text about to be sent to a model outside this session.
 * @returns the text with matched secrets replaced by `<redacted>`.
 */
export function redactSecrets(text: string): string {
  // 0.3.16 (E-1): the generic replacer once keyed on `p1 === undefined` to
  // distinguish "no capture group" — but for a capture-group-free regex the
  // second callback argument is the match OFFSET (a number), so the output
  // carried the offset (e.g. 'use 4<redacted> tomorrow'). The plain patterns
  // now take a literal replacement; only the patterns with a real capture
  // group (the inline-assignment label prefix, the URL scheme/user) keep
  // their parts.
  let out = text
  // v28 G5.1: PEM blocks first — the value-shape passes below only mask the
  // well-known token prefixes, and a key body carries no marker to anchor on.
  out = out.replace(PEM_PRIVATE_KEY_PATTERN, '<redacted-private-key>')
  for (const [, pattern] of SECRET_PATTERNS) {
    out = out.replace(pattern, '<redacted>')
  }
  out = out.replace(URL_CREDENTIALS_PATTERN, (_match, lead?: string) => `${lead ?? ''}<redacted>@`)
  out = out.replace(INLINE_ASSIGNMENT_PATTERN, (_match, lead?: string, prefix?: string, key?: string, separator?: string) =>
    `${lead ?? ''}${prefix ?? ''}${key ?? ''}${separator ?? ''}<redacted>`)
  // S0.3: camelCase keys ride this second, case-aware pass (see CREDENTIAL_KEY_RE).
  // PLAN S1.2 (2026-09-16): exec loop instead of String.replace. The replace
  // callback returned a rejected (non-credential-key) match untouched, but the
  // greedy value group had already consumed the rest of the line, so every
  // LATER key on that line was never scanned and leaked
  // (`{"name": "x", "clientSecret": "supersecret123"}` — the candidate pass is
  // the ONLY layer that reaches a camelCase key, see the comment on the
  // pattern above). A rejected match now advances only past lead+key+separator
  // so the line remainder — including later credential keys — stays scannable.
  // Termination: key is >= 1 char and the separator always carries `[:=]`, so
  // lastIndex strictly grows every round. Trade-off: the resume point sits
  // inside the rejected value, so a value-shaped `k=v` tail can be re-matched
  // too — same over-mask-don't-leak policy as P2-7 (a rejected value's
  // non-credential `a:b` shapes, e.g. `http://…`, still pass: their "key"
  // fails the same predicate). A fresh `g` instance per call keeps the shared
  // const's lastIndex state out of the loop.
  const candidatePattern = new RegExp(CANDIDATE_ASSIGNMENT_PATTERN.source, 'g')
  let candidateOut = ''
  let consumed = 0
  for (let m = candidatePattern.exec(out); m !== null; m = candidatePattern.exec(out)) {
    const lead = m[1] ?? ''
    const key = m[2] ?? ''
    const separator = m[3] ?? ''
    if (!CREDENTIAL_KEY_RE.test(key)) continue
    // Same output shape as the previous replace callback: the value (the rest
    // of the line) is masked wholesale. Its END is located by hand instead of
    // by a consuming group, so neither the accepted nor the rejected path ever
    // re-scans the line remainder (review B-P1, see the pattern note). A
    // rejection resumes exactly where it used to — just past the separator,
    // inside the value — which keeps the documented over-mask-don't-leak
    // trade-off unchanged.
    let valueEnd = m.index + m[0].length
    while (valueEnd < out.length && out[valueEnd] !== '\n' && out[valueEnd] !== '\r') valueEnd += 1
    candidateOut += out.slice(consumed, m.index) + lead + key + separator + '<redacted>'
    consumed = valueEnd
    candidatePattern.lastIndex = valueEnd
  }
  out = candidateOut + out.slice(consumed)
  // Line-paired passes on the split lines. Order matters: the block-style pass
  // runs first so the `<redacted>` it plants still enables the AWS residual
  // pass below (a 40-char secret on the block value line is already gone, but
  // a same-line AWS pair id+secret benefits from both).
  const lines = out.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]
    if (line === undefined) continue
    // S0.3: a bare camelCase key line (`clientSecret:` / `SecretAccessKey:`) pairs
    // with its indented value through the same case-aware predicate as the inline pass.
    const camelKey = /^([\w-]+)\s*:(?:\r)?$/.exec(line)?.[1]
    if (!(BLOCK_KEY_ONLY_LINE.test(line) || (camelKey !== undefined && CREDENTIAL_KEY_RE.test(camelKey)))) continue
    // PLAN S2.3 (2026-09-16): the value is the first NON-EMPTY line after the
    // bare key. The pass used to look at `lines[i + 1]` ONLY, so one blank
    // line between the key and its value (a wrapped YAML entry, a paste with
    // a stray newline — `api_key:\n\n  wJalr…`) abandoned the pairing and the
    // secret crossed verbatim. Blank lines are skipped; the first non-empty
    // line decides: indented → it is the value (mask, with the existing
    // already-`<redacted>` skip and the CRLF-tolerant anchors); dedented → it
    // is the NEXT frontmatter key, not a value (stop, never mask it).
    let valueLine = -1
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j] ?? ''
      if (candidate.trim() === '') continue
      valueLine = j
      break
    }
    if (valueLine < 0) continue
    const next = lines[valueLine] ?? ''
    // Over-masking an indented line under a credential key is acceptable for a
    // redactor (same policy as P2-7); an unindented line is NOT the value.
    // OPT-03: `(?:\r)?$` — see BLOCK_KEY_ONLY_LINE above; without it a CRLF
    // value line never matched and the secret crossed unredacted.
    const [, indent, value, tail] = /^([ \t]+)(\S.*?)([ \t]*)(?:\r)?$/.exec(next) ?? []
    if (indent === undefined || value === undefined) continue
    if (value.includes('<redacted>')) continue
    lines[valueLine] = `${indent}<redacted>${tail ?? ''}`
  }
  out = lines.join('\n')
  // v22 (SEC-4): an AWS SECRET access key is a bare 40-char base64ish run —
  // far too common in legitimate text to mask unconditionally. It is masked
  // only on a line that already shows a redaction or an aws/secret keyword
  // (the paired access key id was just masked there), closing the
  // id-redacted-but-secret-residual reassembly gap.
  out = out.split('\n').map((line) => {
    if (!/<redacted>/.test(line) && !/\baws\b|\bAKIA\b|\bsecret\b/i.test(line)) return line
    return line.replace(/(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g, '<redacted>')
  }).join('\n')
  return out
}
