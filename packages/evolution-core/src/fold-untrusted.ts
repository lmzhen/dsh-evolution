/**
 * Untrusted text rendered as prompt lines (T3-03/A31) — ONE folding rule.
 *
 * The background-review digest embeds conversation text and tool output into a
 * plain-text prompt whose PRODUCT is a plan with write permission. Anything the
 * session ingested (a fetched page, a file body, command output) can therefore
 * carry a newline plus a line shaped like the prompt's own structure — a
 * `SYSTEM:`/`Review kind:` header, a `[result]` evidence line, a second copy
 * of the closing instruction — and forge structure or inject instructions.
 *
 * FOLDING, not deleting: the reader (the model) must still SEE what the data
 * said, it just must never become structure. Line separators become a visible
 * `⏎`, and a line that would read as a role/evidence header gets a visible
 * marker in front of it. Every original character stays in place.
 *
 * The boundary is the separator itself, not only a real newline: a payload can
 * paste the separator verbatim, so neutralization matches after `⏎` whether it
 * came from the fold or from the data. Both edits are idempotent (a second pass
 * cannot add a second marker).
 *
 * Scope: text rendered as its OWN line(s) of a prompt. `render-facts`'
 * sanitizer (evolution-maintenance) is the same posture for `key=value` fields
 * and additionally escapes its block delimiter; it is not superseded here.
 * @module @deepseek-ai/dsh-evolution-core
 */

/** Visible stand-in for a folded line separator: one character that cannot be read as line structure. */
export const UNTRUSTED_LINE_BREAK = ' ⏎ '
/** Visible marker prefixed to a line that would otherwise read as a role/structure header. */
export const UNTRUSTED_LINE_MARK = '· '

const NEWLINES = /\r\n|\r|\n/g
/** A line that reads as structure: a `Label:` head (SYSTEM:, Review kind:, Signals:) or a digest evidence tag.
 * The head is case-TOLERANT on purpose: this family's own prompt labels are mixed case, so an
 * uppercase-only rule neutralized SYSTEM: while leaving a forged "Review kind:" untouched. */
const STRUCTURAL_HEAD = /(^|⏎)([ \t]*)((?:[A-Za-z][A-Za-z0-9 _]{2,}:|\[result\]|\[call\]))/g

/**
 * Fold untrusted `text` so it cannot become structure, then bound it to `limit`
 * visible characters. A non-positive `limit` means "no truncation".
 */
export function foldUntrustedLines(text: string, limit: number): string {
  const folded = text.replace(NEWLINES, UNTRUSTED_LINE_BREAK)
  const marked = folded.replace(
    STRUCTURAL_HEAD,
    (_match, boundary: string, spaces: string, head: string) => `${boundary}${spaces}${UNTRUSTED_LINE_MARK}${head}`,
  )
  return limit > 0 ? marked.slice(0, limit) : marked
}
