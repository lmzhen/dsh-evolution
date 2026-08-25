/**
 * Review-input redaction. Review/curator subagents are the one place where a
 * cross-session conversation snapshot leaves the owning session's context, so
 * credential-shaped text is masked before it is sent. Redaction is best-effort
 * and conservative: it targets well-known secret shapes and inline
 * assignment patterns, never wholesale content.
 */

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['openai-style key', /sk-[A-Za-z0-9_-]{16,}/g],
  ['aws access key', /AKIA[0-9A-Z]{16}/g],
  ['github token', /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ['gitlab token', /glpat-[A-Za-z0-9_-]{16,}/g],
  ['slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ['bearer credential', /Bearer [A-Za-z0-9._~+/=\-]{16,}/g],
  ['inline assignment', /(\b(?:token|api[_-]?key|secret|password|passwd)\b[\s]*[:=][\s]*["']?)([A-Za-z0-9._~+/=\-]{12,})/gi],
]

/**
 * Mask credential-shaped text in a review request.
 * @param text - the assembled review request text.
 * @returns the text with matched secrets replaced by `<redacted>`.
 */
export function redactReviewSecrets(text: string): string {
  let out = text
  for (const [, pattern] of SECRET_PATTERNS) {
    out = out.replace(pattern, (_match, p1?: string) => (p1 === undefined ? '<redacted>' : `${p1}<redacted>`))
  }
  return out
}
