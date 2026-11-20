/**
 * Pure write-intent decision: the smallest authority primitive behind
 * `SkillWriteService`.
 *
 * The caller supplies the *current* bytes and version it read under its own
 * lock. This module decides whether the intent may write, and for `edit`
 * performs the literal match after the version check. It has no IO, lock or
 * session model, so the same rules can be tested and reused by the library,
 * approval replay and unit transactions.
 *
 * Version values are opaque here: a caller using platform `FsVersion` passes
 * that token, a caller that owns canonical bytes passes the content hash. The
 * decision only compares equality; it never reinterprets a token.
 *
 * @module @deepseek-ai/dsh-evolution-core/skill-write-intent
 */
import { contentHash } from './mutations.ts'

/** Current target state supplied by the storage layer. */
export type SkillWriteCurrent =
  | {
    readonly kind: 'present'
    /** Opaque version token in the caller's version model. */
    readonly version: string
    readonly content: string
  }
  | { readonly kind: 'absent' }

/** What a caller wants to write. */
export type SkillWriteIntent =
  | { readonly kind: 'createIfAbsent'; readonly next: string }
  | {
    readonly kind: 'replaceIfVersion'
    /** Version observed before planning the write, in the caller's model. */
    readonly expected: string
    readonly next: string
  }
  | {
    readonly kind: 'editIfVersion'
    readonly expected: string
    readonly oldString: string
    readonly newString: string
    readonly replaceAll?: boolean
  }

/** Why an intent was refused. */
export type SkillWriteRefusalReason =
  | 'already-exists'
  | 'not-found'
  | 'stale'
  | 'not-found-match'
  | 'ambiguous'
  | 'invalid'

/** The decision the caller executes under its lock. */
export type SkillWriteDecision =
  | {
    readonly kind: 'write'
    readonly next: string
    /** Number of literal replacements; 0 for create/replace. */
    readonly replacements: number
  }
  | {
    readonly kind: 'refuse'
    readonly reason: SkillWriteRefusalReason
    /** Human-facing detail for a typed tool error. */
    readonly message: string
  }

/**
 * Content version used when the caller owns canonical bytes (SkillLibrary
 * reads). Platform-read observations use the platform token instead.
 * @param content - canonical text.
 * @returns sha256 of LF-normalized content.
 */
export function skillContentVersion(content: string): string {
  return contentHash(content)
}

/**
 * Decide one write against the current state.
 * @param intent - the requested create/replace/edit.
 * @param current - the target state read under the caller's write lock.
 * @returns either the exact next bytes, or a typed refusal.
 */
export function decideSkillWrite(intent: SkillWriteIntent, current: SkillWriteCurrent): SkillWriteDecision {
  switch (intent.kind) {
    case 'createIfAbsent':
      return current.kind === 'absent'
        ? { kind: 'write', next: intent.next, replacements: 0 }
        : { kind: 'refuse', reason: 'already-exists', message: 'skill target already exists' }

    case 'replaceIfVersion':
      if (current.kind === 'absent') {
        return { kind: 'refuse', reason: 'not-found', message: 'skill target does not exist' }
      }
      if (current.version !== intent.expected) {
        return { kind: 'refuse', reason: 'stale', message: 'skill target changed since it was read' }
      }
      return { kind: 'write', next: intent.next, replacements: 0 }

    case 'editIfVersion': {
      if (current.kind === 'absent') {
        return { kind: 'refuse', reason: 'not-found', message: 'skill target does not exist' }
      }
      // Platform edit order: version before literal matching. A stale writer
      // must re-read even when its old_string would still match a different region.
      if (current.version !== intent.expected) {
        return { kind: 'refuse', reason: 'stale', message: 'skill target changed since it was read' }
      }
      return decideLiteralEdit(current.content, intent.oldString, intent.newString, intent.replaceAll === true)
    }
  }
}

/**
 * Apply one literal edit after the caller already checked the version.
 * @param content - current content.
 * @param oldString - exact literal to replace.
 * @param newString - replacement.
 * @param replaceAll - explicit all-occurrences mode; default is unique-match.
 * @returns write decision with replacement count, or a typed refusal.
 */
export function decideLiteralEdit(content: string, oldString: string, newString: string, replaceAll: boolean): SkillWriteDecision {
  if (oldString.length === 0) {
    return { kind: 'refuse', reason: 'invalid', message: 'old_string must be a non-empty string' }
  }
  if (oldString === newString) {
    return { kind: 'refuse', reason: 'invalid', message: 'old_string and new_string must differ' }
  }
  const offsets = matchOffsets(content, oldString)
  if (offsets.length === 0) {
    return { kind: 'refuse', reason: 'not-found-match', message: 'old_string did not appear verbatim' }
  }
  if (!replaceAll && offsets.length > 1) {
    return { kind: 'refuse', reason: 'ambiguous', message: 'old_string appears more than once; make it unique or set replace_all' }
  }
  const first = offsets[0]
  if (first === undefined) {
    return { kind: 'refuse', reason: 'not-found-match', message: 'old_string did not appear verbatim' }
  }
  const next = replaceAll
    ? content.split(oldString).join(newString)
    : content.slice(0, first) + newString + content.slice(first + oldString.length)
  return { kind: 'write', next, replacements: offsets.length }
}

/** All non-overlapping occurrences of a literal, in content order. */
function matchOffsets(content: string, literal: string): number[] {
  const offsets: number[] = []
  let from = 0
  while (from <= content.length - literal.length) {
    const at = content.indexOf(literal, from)
    if (at < 0) break
    offsets.push(at)
    from = at + literal.length
  }
  return offsets
}
