/**
 * The memory op's payload field, resolved in ONE place (T3-06/A34).
 *
 * A memory op carries its body under two names — `facts` (the original) and
 * `content` (the schema alias) — and every reader used to resolve the pair with
 * `op.facts ?? op.content`. `??` only skips null/undefined, so
 * `{ facts: '', content: '正文' }` counted as "has facts": the plan validator
 * refused the op as empty (a FALSE refusal of a payload that is right there),
 * and the writers that normalized the pair dropped the body to `''`.
 *
 * The payload is the first field whose TRIMMED value is non-empty — a blank
 * string carries no payload, so it yields to its alias. Both blank (or absent)
 * ⇒ `''`, the one shape every caller already reads as "no payload".
 *
 * Non-string values are SKIPPED, never trimmed: a truthy non-string `facts`
 * used to reach `.trim()` and throw a TypeError out of callers that promise to
 * be deterministic (the E-60 / P2-1 class). The field-type gates reject such an
 * op on their own; this helper must not be the one that throws.
 *
 * The union posture matches evolution-threat's E-28a scan (BOTH fields are
 * scanned, not only the first truthy one); the two agree on what counts as
 * provided.
 * @module @deepseek-ai/dsh-evolution-core
 */

/** Anything carrying the two payload aliases; `null` (a persisted or garbage op) resolves to `''`. */
export interface PayloadFields {
  facts?: unknown
  content?: unknown
}

/** The op's payload text: the first of `facts`/`content` whose trim is non-empty, trimmed; `''` when neither carries one. */
export function payloadText(op: PayloadFields | null | undefined): string {
  for (const value of [op?.facts, op?.content]) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text !== '') return text
  }
  return ''
}
