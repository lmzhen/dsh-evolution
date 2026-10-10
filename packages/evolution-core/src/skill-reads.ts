/**
 * The read-before-write RULE: which writes need a prior read, and which targets count as read.
 *
 * ONE rule for TWO enforcement points (design `dsh-evolution-write-gate-design.md` §4.2): the
 * tool path refuses an unread mutating write (E-318), and the plan path drops such an op from a
 * background review's plan. Before this module the rule lived in `evolution-review` only, so the
 * tool path could not see it at all.
 *
 * The READER is not here either: `tool-dispatch.collectReadSkillNames(events)` folds a session log
 * into the names read through a non-failed dispatch — the review's old session-shaped copy was a
 * line-for-line duplicate of it. What this module adds over it is the session-shaped ADAPTER
 * (`sessionReadSkillNames`), for the ONE caller that holds a session only STRUCTURALLY (the tool
 * path's gate, whose exec view may be a bare stub): it answers "which accessor, and what does an
 * unreadable session mean" — `undefined`, so the gate keeps its previous behavior instead of
 * refusing every write. The review path reads a real platform `Session` and calls the reader
 * directly; a fallback there would be dead code for an impossible case. The structural accessor is
 * the family's OWN `readEvents` (A69): production reads no deprecated platform log accessor.
 *
 * v32 REV-06(a) is preserved by the dispatch normalizer: a skill counts as READ only when its read
 * did not fail, so a failed/timeout read cannot pass the gate and let a writer blind-overwrite
 * content the model never saw. Matching `tool/call` directly (the pre-v37 form) meant every PTC
 * session (`tool/ptc-dispatch*`) collected an EMPTY set, so every mutating op the model HAD read
 * was dropped — and nothing reported the loss.
 * @module @deepseek-ai/dsh-evolution-core
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { collectReadSkillNames } from './tool-dispatch.ts'
import { sessionReadNames } from './session-projection.ts'

/**
 * The family's OWN structural view of a session log, for a caller that holds no platform `Session`
 * (the tool path's exec view may be a bare stub). The CALLER supplies it — the family reads no
 * deprecated platform accessor (`snapshotEvents`/`eventAt`/`ownEvents`): those are the platform's own
 * migration debt, and a family that reads them keeps the deprecated surface alive in every
 * composition (A69 / 6-2). A platform `Session` does not carry this member and therefore takes the
 * projection path below; this view exists so the fallback still has a basis instead of being deleted
 * (deleting it would leave a stub session's read-before-write gate with nothing to fold).
 */
export interface EvolutionSessionLogView {
  /** @returns the events this view can see, oldest first; absent when the caller has no log. */
  readEvents?: () => Iterable<{ type: string; data?: unknown }>
}

/**
 * The skill names ONE session read, or `undefined` when its log is not readable.
 *
 * Two readers, in this order: the family's `evolutionReads` projection for a platform `Session`
 * (0.2.x's live read — the deprecated synchronous log read is gone from production), then the
 * STRUCTURAL accessor for a view that is not a `Session` at all. The tool path's exec view may be a
 * bare stub, which is what this module exists for; a real Session always takes the first path.
 *
 * `undefined` is NOT an empty set: a caller that must decide (the tool path's read-before-write
 * gate) can then keep its previous behavior instead of refusing every write in a composition whose
 * session objects expose no log at all.
 * @param ctx - a context of the runtime.
 * @param session - the session whose reads are wanted; `undefined` when the call carries none.
 * @returns the names read through a non-failed `skill` dispatch, or `undefined` when unreadable.
 */
export function sessionReadSkillNames(ctx: Context, session: EvolutionSessionLogView | undefined): ReadonlySet<string> | undefined {
  if (session === undefined) return undefined
  const projected = sessionReadNames(ctx, session as Session)
  if (projected !== undefined) return projected
  const events = session.readEvents?.()
  return events === undefined ? undefined : collectReadSkillNames(events)
}

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
