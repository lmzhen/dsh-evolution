/**
 * The read-before-write RULE: which writes need a prior read, and which targets count as read.
 *
 * ONE rule for TWO enforcement points (design `dsh-evolution-write-gate-design.md` §4.2): the
 * tool path refuses an unread mutating write (E-318), and the plan path drops such an op from a
 * background review's plan. Before this module the rule lived in `evolution-review` only, so the
 * tool path could not see it at all.
 *
 * The READER is NOT here: `tool-dispatch.collectReadSkillNames(events)` already folds a session
 * log into the names read through a non-failed dispatch — the review's old session-shaped copy was
 * a line-for-line duplicate of it. Callers pass `session.snapshotEvents()`. Keeping the rule and
 * the reader in their two existing homes is what makes this ONE fact instead of three.
 *
 * v32 REV-06(a) is preserved by the dispatch normalizer: a skill counts as READ only when its read
 * did not fail, so a failed/timeout read cannot pass the gate and let a writer blind-overwrite
 * content the model never saw. Matching `tool/call` directly (the pre-v37 form) meant every PTC
 * session (`tool/ptc-dispatch*`) collected an EMPTY set, so every mutating op the model HAD read
 * was dropped — and nothing reported the loss.
 * @module @deepseek-ai/dsh-evolution-core
 */

/** Actions whose target must have been read first (create is authorship, so it is exempt). */
export const READ_REQUIRED_ACTIONS: readonly string[] = Object.freeze([
  'edit', 'update', 'patch', 'delete', 'write_file', 'remove_file', 'restructure',
])

/**
 * Does this one op write a skill the caller never read?
 *
 * V6-26 (0.3.37): the validator normalizes a missing action to `patch`, so a missing action is a
 * read-required write, never silently exempt.
 * @param op - one skill operation (from a tool call or a review plan).
 * @param readNames - names read this session, from {@link collectReadSkillNames}.
 * @returns true when the op is a read-required write to an unread target.
 */
export function isUnreadWrite(
  op: { action?: string; name?: string },
  readNames: ReadonlySet<string>,
): boolean {
  if (!op.name) return false
  return READ_REQUIRED_ACTIONS.includes(op.action ?? 'patch') && !readNames.has(op.name)
}

/**
 * Drop mutating ops whose target was not read this session, in place.
 *
 * Covers the same mutating surface Hermes guards (edit/patch/write_file/remove_file), so a
 * background review cannot blind-touch support files or edits of skills it never loaded.
 * @param ops - the plan's ops; dropped entries are removed in place.
 * @param readNames - names read this session.
 * @returns the count of dropped ops, so the plan event can report them as rejected.
 */
export function filterUnreadSkillOps(
  ops: Array<{ action?: string; name?: string }>,
  readNames: ReadonlySet<string>,
): number {
  let dropped = 0
  for (let index = ops.length - 1; index >= 0; index -= 1) {
    const op = ops[index]
    if (!op) continue
    if (isUnreadWrite(op, readNames)) {
      ops.splice(index, 1)
      dropped += 1
    }
  }
  return dropped
}
