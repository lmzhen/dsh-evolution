/**
 * G3a: the pure half of `undoUnit` — deciding WHAT to write back, with no io and no host.
 *
 * Kept apart from the curator so it can be tested in isolation (the curator module needs a cordis
 * host; this file needs nothing but the version records). The rules are the storage seat’s:
 *
 * - one path is described by the triple (baseline, oldest after, newest after): the bytes to write
 *   back are the BASELINE this unit minted for that path, and only when there is no baseline do we
 *   fall back to the OLDEST after’s `beforeHash`. Using the NEWEST one’s `beforeHash` would roll the
 *   file back to a state from the middle of the unit — the half-split file this contract exists to
 *   avoid;
 * - a path with no baseline at all did not exist before the unit ⇒ it is REMOVED, and the removal is
 *   anchored on the newest after-entry’s hash so a hand edit refuses instead of being deleted;
 * - anything the plan cannot resolve is a refusal, and the caller writes nothing (pre-flight).
 */
import { BASELINE_ACTION, entryTarget, type SkillVersion } from '@deepseek-ai/dsh-evolution-core'

/** One path’s action inside a unit undo. */
export interface UnitUndoOp {
  /** True when the unit created the file (no pre-unit bytes) ⇒ remove it, anchored. */
  remove: boolean
  /** The support file, relative to the skill directory. */
  path: string
  /** The blob to write back (hash), or undefined when the unit created the path. */
  preUnitHash: string | undefined
  /** The bytes the unit left on disk — the CAS anchor for either action. */
  expectedHash: string
}

/** What the undo would do, plus why it refuses to do anything. */
export interface UnitUndoPlan {
  ops: UnitUndoOp[]
  /** The body’s pre-unit bytes (hash), or undefined when the unit did not rewrite the body. */
  bodyPreUnitHash: string | undefined
  /** Non-empty ⇒ the caller must NOT write anything (pre-flight). */
  refusals: string[]
}

/** The newest unit the index carries, or undefined when no entry has a unit id yet. */
export function newestUnitId(versions: SkillVersion[]): string | undefined {
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    const unit = versions[i]?.unitId
    if (unit !== undefined) return unit
  }
  return undefined
}

interface Slot { baseline?: SkillVersion; oldest?: SkillVersion; newest?: SkillVersion }

/**
 * Decide the whole unit rollback. Pure: the caller resolves the hashes to bytes afterwards.
 * @param members - the unit’s entries (any order from the index; oldest first is what it emits).
 * @param versions - the whole index, so `entryTarget` can classify an entry the way the faces do.
 * @returns the operations and the refusals.
 */
export function planUnitUndo(members: SkillVersion[], versions: SkillVersion[]): UnitUndoPlan {
  const slots = new Map<string, Slot>()
  const refusals: string[] = []
  const body: Slot = {}
  for (const entry of members) {
    const path = entry.path
    const isSupport = path !== undefined && entryTarget(entry, versions) === 'support'
    if (!isSupport) {
      if (entry.action === BASELINE_ACTION) body.baseline ??= entry
      else { body.oldest ??= entry; body.newest = entry }
      continue
    }
    const slot = slots.get(path) ?? {}
    slots.set(path, slot)
    if (entry.action === BASELINE_ACTION) slot.baseline ??= entry
    else { slot.oldest ??= entry; slot.newest = entry }
  }
  const ops: UnitUndoOp[] = []
  for (const [path, slot] of slots) {
    if (slot.newest === undefined) { refusals.push(`${path}（单元里没有该路径的 after 条目）`); continue }
    const preUnitHash = slot.baseline !== undefined ? slot.baseline.hash : slot.oldest?.beforeHash
    ops.push({ remove: preUnitHash === undefined, path, preUnitHash, expectedHash: slot.newest.hash })
  }
  const bodyPreUnitHash = body.baseline !== undefined ? body.baseline.hash : body.oldest?.beforeHash
  return { ops, bodyPreUnitHash, refusals }
}
