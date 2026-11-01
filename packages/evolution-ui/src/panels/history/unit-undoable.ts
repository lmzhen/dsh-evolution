/**
 * G3b: undoability is a property of the UNIT, not of one entry.
 *
 * Every entry of a unit shares the same live body, so "is this undoable" must answer the same for all
 * of them; computing it per entry made the body row say `false` (already current) while a support row
 * of the SAME transaction said `true` — two entrances to one unit in one panel.
 *
 * Entries without a unit id keep the per-entry answer (they are their own singleton unit).
 */
import { isLandmark, type SkillVersion } from '@deepseek-ai/dsh-evolution-core'

/** @param members - every entry that shares the unit (content and support chains together).
 * @param liveHash - hash of the live body, or null when the skill is not readable.
 * @returns one flag per unit id; unknown ids fall back to the per-entry rule. */

export function unitUndoableFlags(members: readonly SkillVersion[], liveHash: string | null): Map<string, boolean> {
  const flags = new Map<string, boolean>()
  for (const entry of members) {
    if (entry.unitId === undefined) continue
    // A cross-skill LANDMARK describes a unit whose records live in ANOTHER skill, so its hash says
    // nothing about this skill's live body -- it must not poison the unit's flag.
    if (isLandmark(entry)) continue
    const differs = entry.hash !== liveHash
    flags.set(entry.unitId, (flags.get(entry.unitId) ?? false) || differs)
  }
  return flags
}

/** @param entry - the entry being rendered. @param flags - the unit flags from {@link unitUndoableFlags}.
 * @param liveHash - hash of the live body. @returns the row's `undoable` value. */
export function undoableFor(entry: SkillVersion, flags: Map<string, boolean>, liveHash: string | null): boolean | undefined {
  // Frozen G3b shape: a landmark reports `undefined` (the wire omits the key) -- never `false`,
  // which would claim this skill can prove the unit is not undoable.
  if (isLandmark(entry)) return undefined
  const unit = entry.unitId
  if (unit !== undefined) {
    const flagged = flags.get(unit)
    if (flagged !== undefined) return flagged
  }
  return entry.hash !== liveHash
}
