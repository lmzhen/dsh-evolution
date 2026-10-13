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
/** Minimal io view the shell needs (structural, so this module imports no io type). */
export interface UnitMemberIo { readText(path: string): Promise<string | null> }

/**
 * The io shell (A19.2): open ONLY the known keys -- never enumerate a directory. A skill whose index
 * file is unreadable becomes `null` (index-absent), which the core then reports by name.
 */
export async function resolveUnitMembers(
  root: string,
  io: UnitMemberIo,
  head: UnitHeadInput,
  indexPath: (root: string, name: string) => string,
  readEntries: (raw: string | null) => readonly SkillVersion[],
): Promise<UnitMembers> {
  const indexes = new Map<string, string | null>()
  for (const skill of candidateSkills(head)) {
    let text: string | null = null
    try { text = await io.readText(indexPath(root, skill)) } catch { text = null }
    indexes.set(skill, text)
  }
  return resolveUnitMembersFromIndexes(head, indexes, (raw) => readEntries(raw))
}
/** A landmark is jumpable only when its owner exists AND that index still holds the unit. */
export type LandmarkVerdict =
  | { readonly jumpable: true }
  | { readonly jumpable: false; readonly reason: 'not-a-landmark' | 'owner-absent' | 'unit-absent' }

/** @param entry - the entry being judged. @param ownerEntries - the owner skill's index, or null when
 * the owner has no readable index. */
export function landmarkVerdict(entry: SkillVersion, ownerEntries: readonly SkillVersion[] | null): LandmarkVerdict {
  const head = entry.unitHead
  const skill = head !== undefined && head.moves === undefined ? head.skill : undefined
  if (skill === undefined || entry.unitId === undefined) return { jumpable: false, reason: 'not-a-landmark' }
  if (ownerEntries === null) return { jumpable: false, reason: 'owner-absent' }
  const held = ownerEntries.some((candidate) => candidate.unitId === entry.unitId)
  return held ? { jumpable: true } : { jumpable: false, reason: 'unit-absent' }
}

/** One cross-index orphan: a landmark whose owner or unit can no longer be reached. */
export interface StaleRouteStub {
  readonly skill: string
  readonly v: number
  readonly owner: string
  readonly reason: 'owner-absent' | 'unit-absent'
}

/**
 * Scan a whole corpus (skill name -> index entries, or null when unreadable) for stale route stubs.
 * Order follows the caller's map insertion order (deterministic for a given input); nothing is cached.
 */
export function staleRouteStubs(indexes: ReadonlyMap<string, readonly SkillVersion[] | null>): StaleRouteStub[] {
  const out: StaleRouteStub[] = []
  for (const [skill, entries] of indexes) {
    if (entries === null) continue
    for (const entry of entries) {
      const head = entry.unitHead
      const owner = head !== undefined && head.moves === undefined ? head.skill : undefined
      if (owner === undefined) continue
      const verdict = landmarkVerdict(entry, indexes.get(owner) ?? null)
      if (!verdict.jumpable && verdict.reason !== 'not-a-landmark') out.push({ skill, v: entry.v, owner, reason: verdict.reason })
    }
  }
  return out
}
