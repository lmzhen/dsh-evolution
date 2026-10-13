/**
 * G3b: resolve a unit's members from the skills named in its head's `sources[]`.
 *
 * Pure core (no io): the caller hands in each candidate skill's index TEXT, so this function can be
 * tested with synthetic indexes. Membership is decided ONLY by the known keys -- never by scanning a
 * directory -- and the result order is the `sources[]` order with the head skill first (deterministic:
 * no Map/Set iteration order leaks into the output).
 */
import type { SkillVersion, UnitHead } from './skill-history.ts'

export interface UnitMemberSlice { readonly skill: string; readonly entries: readonly SkillVersion[] }
export interface UnitMemberIssue { readonly skill: string; readonly reason: 'index-absent' | 'unit-absent' }
export interface UnitConflict { readonly kind: 'missing' | 'foreign' | 'duplicated'; readonly path: string }
export interface UnitMembers {
  readonly members: readonly UnitMemberSlice[]
  readonly missing: readonly UnitMemberIssue[]
  readonly conflicts: readonly UnitConflict[]
}

export interface UnitHeadInput {
  readonly skill: string
  readonly unitId: string
  readonly sources: readonly { readonly skill: string }[]
  readonly unitHead?: UnitHead
}

/** Candidate skills: head first, then `sources[]` order, DEDUPLICATED (sources may name the head). */
export function candidateSkills(head: UnitHeadInput): string[] {
  const out: string[] = [head.skill]
  for (const source of head.sources) if (!out.includes(source.skill)) out.push(source.skill)
  return out
}

/** @param indexes - skill name -> that skill's index text, or null when the index file is absent. */
export function resolveUnitMembersFromIndexes(
  head: UnitHeadInput,
  indexes: ReadonlyMap<string, string | null>,
  readEntries: (text: string) => readonly SkillVersion[],
): UnitMembers {
  const members: UnitMemberSlice[] = []
  const missing: UnitMemberIssue[] = []
  for (const skill of candidateSkills(head)) {
    const text = indexes.get(skill)
    if (text === undefined || text === null) { missing.push({ skill, reason: 'index-absent' }); continue }
    const entries = readEntries(text).filter((entry) => entry.unitId === head.unitId)
    if (entries.length === 0) { missing.push({ skill, reason: 'unit-absent' }); continue }
    members.push({ skill, entries })
  }
  const conflicts: UnitConflict[] = []
  const manifest = head.unitHead?.moves ?? undefined
  if (manifest !== undefined) {
    const shardPaths: string[] = []
    for (const slice of members) {
      for (const entry of slice.entries) {
        for (const move of (entry.unitHead?.moves ?? [])) {
          const path = String((move as { path?: unknown }).path ?? '')
          if (path !== '') shardPaths.push(path)
        }
      }
    }
    const wanted = manifest.map((move) => String((move as { path?: unknown }).path ?? '')).filter((p) => p !== '')
    for (const path of wanted) if (!shardPaths.includes(path)) conflicts.push({ kind: 'missing', path })
    for (const path of shardPaths) if (!wanted.includes(path)) conflicts.push({ kind: 'foreign', path })
    for (const path of wanted) if (shardPaths.filter((p) => p === path).length > 1) conflicts.push({ kind: 'duplicated', path })
  }
  return { members, missing, conflicts }
}

/** A unit's members are trustworthy only when nothing is missing and nothing conflicts. */
export function unitMembersAreComplete(members: UnitMembers): boolean {
  return members.missing.length === 0 && members.conflicts.length === 0
}
