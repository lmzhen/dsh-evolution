import { h2Sections } from './document-body.ts'
import type { SkillSummary } from './skill-store.ts'

/** One existing class-level owner candidate, with the routing facts a semantic adjudicator needs. */
export interface OwnerCandidate {
  name: string
  description: string
  whenToUse?: string
  headings: string[]
  protectedBy: string | null
  protectionUnknown: boolean
  managed: boolean
}

export interface OwnerExclusion {
  name: string
  reason: 'source' | 'unreadable'
}

export interface OwnerLookup {
  source: string
  candidates: OwnerCandidate[]
  excluded: OwnerExclusion[]
}

/**
 * Project the current library listing into owner candidates.
 *
 * The source is excluded; a skill with an empty description is named in
 * excluded rather than silently dropped. Protected candidates remain visible
 * (so a caller can explain why it refused), but are marked for the writer's
 * protection gate. Headings reuse h2Sections; no second heading scanner.
 * @param source - skill being extracted from.
 * @param summaries - SkillLibrary.list({ withContent: true, withFrontmatter: true }).
 * @returns stable-name-ordered candidates plus explicit exclusions.
 */
export function ownerCandidatesFromSummaries(
  source: string,
  summaries: readonly SkillSummary[],
): OwnerLookup {
  const normalized = source.trim()
  const candidates: OwnerCandidate[] = []
  const excluded: OwnerExclusion[] = []
  for (const summary of summaries) {
    if (summary.name === normalized) {
      excluded.push({ name: summary.name, reason: 'source' })
      continue
    }
    if (summary.description.trim() === '') {
      excluded.push({ name: summary.name, reason: 'unreadable' })
      continue
    }
    candidates.push({
      name: summary.name,
      description: summary.description,
      ...(summary.whenToUse === undefined ? {} : { whenToUse: summary.whenToUse }),
      headings: h2Sections(summary.content ?? '').map(section => section.title),
      protectedBy: summary.protectedBy,
      protectionUnknown: summary.protectionUnknown,
      managed: summary.managed,
    })
  }
  candidates.sort((left, right) => left.name.localeCompare(right.name))
  excluded.sort((left, right) => left.name.localeCompare(right.name))
  return { source: normalized, candidates, excluded }
}

/**
 * Find one named candidate in a lookup.
 * @param lookup - projection from ownerCandidatesFromSummaries.
 * @param name - exact skill name.
 * @returns the candidate, or undefined when absent.
 */
export function findOwnerCandidate(lookup: OwnerLookup, name: string): OwnerCandidate | undefined {
  return lookup.candidates.find(candidate => candidate.name === name)
}
