/**
 * Content-revision identity shared by every planner that records a decision and every
 * committer that re-checks it.
 *
 * A skill's revision covers the trimmed NAME, the SKILL.md body and every support file
 * (`references/…`, `templates/…`, `scripts/…`, `assets/…`), each as read through the
 * store. The merge domain records a decision-time anchor and the store compares the live
 * anchor before writing; both sides must hash the same bytes or the compare is meaningless,
 * so the hash lives HERE and nowhere else.
 */
import { contentHash } from './mutations.ts'

/** One support file as read through the store (path is normalized `references/x.md`). */
export interface RevisionFile {
  readonly path: string
  readonly content: string
}

/** The two-state content anchor: absent (no live skill) or a content hash. */
export type RevisionAnchor = { readonly kind: 'absent' } | { readonly kind: 'present'; readonly sha256: string }

/**
 * Canonical fingerprint of one skill's content.
 *
 * Field order and separators are a wire format: decisions persist anchors derived from
 * this string, and a later commit compares against it. Do not reorder.
 * @param name - the (trimmed) skill name.
 * @param body - the SKILL.md text.
 * @param files - every support file under SUPPORT_DIRS.
 * @returns the fingerprint string to hash.
 */
export function revisionFingerprint(name: string, body: string, files: readonly RevisionFile[]): string {
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path))
  return name + '\u0000' + body + '\u0000' + ordered.map(file => file.path + '\u0000' + file.content).join('\u0000')
}

/** Hash one fingerprint into its anchor (CRLF-normalized by contentHash). */
export function revisionAnchor(name: string, body: string, files: readonly RevisionFile[]): RevisionAnchor {
  return { kind: 'present', sha256: contentHash(revisionFingerprint(name, body, files)) }
}

/** Anchor for a skill whose body may be absent. */
export function revisionAnchorOf(name: string, body: string | null, files: readonly RevisionFile[]): RevisionAnchor {
  return body === null ? { kind: 'absent' } : revisionAnchor(name, body, files)
}

/**
 * Support digest over several skills' fingerprints: the union of their full content.
 *
 * Sort is by fingerprint (name-prefixed), so name order and fingerprint order agree and
 * a decision-time digest can be recomputed by a committer that only has hashes.
 * @param fingerprints - one fingerprint per involved skill (missing skills simply absent).
 * @returns the digest recorded on a decision and re-checked at commit.
 */
export function revisionSupportDigest(fingerprints: readonly string[]): string {
  return contentHash([...fingerprints].sort().join('\u0000'))
}
