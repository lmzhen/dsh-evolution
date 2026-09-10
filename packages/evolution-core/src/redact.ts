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
// with no separator (100k chars measured ~23-26s, synchronously). The prefix
// is now anchored by `(^|[^\w-])` and bounded to 64 chars, so the regex is
// linear in the input and cannot stall the event loop.
// P2-7/P2-8 (v19): the value is the WHOLE rest of the line — one branch, no
// quoted/unquoted alternation. Two defects forced this: the separator's `[\s]*`
// matched a newline, so `api_key:` with no same-line value swallowed the NEXT
// line; and the quoted branch short-circuited at the first inner quote, leaving
// `token="a"b"c" tail` as `token=<redacted>b"c" tail`. Over-masking a line is
// acceptable for a redactor; leaking or eating an unrelated line is not.
// Capture groups: 1 = leading boundary (kept), 2 = connected prefix (kept),
// 3 = key (kept), 4 = separator (kept), 5 = value (masked).
const INLINE_ASSIGNMENT_PATTERN = new RegExp(
  '(^|[^\\w-])([\\w-]{0,64}[_\\-])?((?:token|api[_-]?key|secret|password|passwd)' +
  '(?:[_\\-][\\w-]{0,64})?)\\b([\\t ]*[:=][\\t ]*)' +
  '([^\\r\\n]+)',
  'gi',
)

// v22 (SEC-4): a scheme://user:password@host URL — only the password segment
// is masked; the group-preserving replace keeps the scheme/user readable so a
// connection string stays diagnosable.
const URL_CREDENTIALS_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s/@]+)@/gi

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
  for (const [, pattern] of SECRET_PATTERNS) {
    out = out.replace(pattern, '<redacted>')
  }
  out = out.replace(URL_CREDENTIALS_PATTERN, (_match, lead?: string) => `${lead ?? ''}<redacted>@`)
  out = out.replace(INLINE_ASSIGNMENT_PATTERN, (_match, lead?: string, prefix?: string, key?: string, separator?: string) =>
    `${lead ?? ''}${prefix ?? ''}${key ?? ''}${separator ?? ''}<redacted>`)
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
