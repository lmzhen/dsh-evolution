/**
 * G3a: the pure half of `undoUnit` — deciding WHAT to write back, with no io and no host.
 *
 * The slot rules live in core (`planUnitUndoAcross`); this adapter keeps the curator’s
 * single-skill call shape and splits the body op out of the support ops.
 */
import { planUnitUndoAcross, type SkillVersion } from '@deepseek-ai/dsh-evolution-core'

/** One support path’s action inside a unit undo. */
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

/**
 * Decide the whole single-skill unit rollback.
 * @param members - the unit’s entries for one skill, oldest first.
 * @param _versions - the whole index; kept for parity with the previous signature.
 * @returns the support ops, the body baseline, and the refusals.
 */
export function planUnitUndo(members: SkillVersion[], _versions: SkillVersion[]): UnitUndoPlan {
  const plan = planUnitUndoAcross([{ skill: '', entries: members, status: 'live' }])
  const ops = plan.ops.filter(op => op.path !== '').map(op => ({ remove: op.remove, path: op.path, preUnitHash: op.preUnitHash, expectedHash: op.expectedHash }))
  const body = plan.ops.find(op => op.path === '')
  return { ops, bodyPreUnitHash: body?.preUnitHash, refusals: [...plan.refusals] }
}