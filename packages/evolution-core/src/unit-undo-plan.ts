/**
 * Cross-skill unit undo planner.
 *
 * The curator's single-skill undo already proves the rule: one path is described by
 * (baseline, oldest after, newest after), and a path the unit created is removed. A merge
 * unit adds two shapes:
 *
 * - a source that the merge ARCHIVED: undo restores it from .archive; it has no live ops;
 * - a target the merge CREATED: undo archives the target (never hard-deletes it); it has no
 *   body op.
 *
 * The plan is pure; the executor resolves hashes to bytes and applies anchors. Any refusal
 * means the caller writes nothing.
 */
import { BASELINE_ACTION, entryTarget, type SkillVersion } from './skill-history.ts'

export interface UnitUndoMember {
  readonly skill: string
  /** Entries of this unit for this skill. */
  readonly entries: readonly SkillVersion[]
  readonly status: 'live' | 'archived' | 'missing'
  /** Required when status is archived: the archived directory to restore from. */
  readonly archivedPath?: string
  /** True when this unit created the skill (the target of a merge-into-new). */
  readonly createdInUnit?: boolean
}

export interface UnitUndoOp {
  readonly skill: string
  /** '' means SKILL.md; otherwise a support path relative to the skill directory. */
  readonly path: string
  readonly remove: boolean
  readonly preUnitHash?: string
  /** The bytes the unit left on disk; the executor's CAS anchor. */
  readonly expectedHash: string
}

export interface UnitUndoRestore {
  readonly skill: string
  readonly archivedPath: string
}

export interface UnitUndoPlan {
  readonly ops: readonly UnitUndoOp[]
  readonly restores: readonly UnitUndoRestore[]
  /** New targets: undo archives them instead of writing a body. */
  readonly archiveTargets: readonly string[]
  readonly refusals: readonly string[]
}

interface Slot {
  baseline?: SkillVersion
  oldest?: SkillVersion
  newest?: SkillVersion
}

function slotsOf(entries: readonly SkillVersion[]): { body: Slot; support: Map<string, Slot>; refusals: string[] } {
  const body: Slot = {}
  const support = new Map<string, Slot>()
  const refusals: string[] = []
  for (const entry of entries) {
    const isSupport = entry.path !== undefined && entryTarget(entry, entries) === 'support'
    if (!isSupport) {
      if (entry.action === BASELINE_ACTION) body.baseline ??= entry
      else {
        body.oldest ??= entry
        body.newest = entry
      }
      continue
    }
    const path = entry.path as string
    const slot = support.get(path) ?? {}
    support.set(path, slot)
    if (entry.action === BASELINE_ACTION) slot.baseline ??= entry
    else {
      slot.oldest ??= entry
      slot.newest = entry
    }
  }
  for (const [path, slot] of support) {
    if (slot.newest === undefined) refusals.push(`${path}（单元里没有该路径的 after 条目）`)
  }
  return { body, support, refusals }
}

/** Plan one unit across a live target and any archived sources. */
export function planUnitUndoAcross(members: readonly UnitUndoMember[]): UnitUndoPlan {
  const ops: UnitUndoOp[] = []
  const restores: UnitUndoRestore[] = []
  const archiveTargets: string[] = []
  const refusals: string[] = []
  for (const member of members) {
    if (member.status === 'missing') {
      refusals.push(`${member.skill}（成员技能不在活动树或归档里）`)
      continue
    }
    if (member.status === 'archived') {
      if (member.archivedPath === undefined || member.archivedPath === '') {
        refusals.push(`${member.skill}（归档成员缺少归档路径）`)
        continue
      }
      restores.push({ skill: member.skill, archivedPath: member.archivedPath })
      continue
    }
    if (member.createdInUnit === true) {
      archiveTargets.push(member.skill)
      continue
    }
    const { body, support, refusals: slotRefusals } = slotsOf(member.entries)
    refusals.push(...slotRefusals.map(reason => member.skill + '：' + reason))
    for (const [path, slot] of support) {
      if (slot.newest === undefined) continue
      const preUnitHash = slot.baseline !== undefined ? slot.baseline.hash : slot.oldest?.beforeHash
      ops.push({
        skill: member.skill,
        path,
        remove: preUnitHash === undefined,
        ...(preUnitHash === undefined ? {} : { preUnitHash }),
        expectedHash: slot.newest.hash,
      })
    }
    if (body.newest !== undefined) {
      const preUnitHash = body.baseline !== undefined ? body.baseline.hash : body.oldest?.beforeHash
      if (preUnitHash === undefined) refusals.push(`${member.skill}：SKILL.md 缺少单元前字节`)
      else ops.push({ skill: member.skill, path: '', remove: false, preUnitHash, expectedHash: body.newest.hash })
    }
  }
  return { ops, restores, archiveTargets, refusals }
}
