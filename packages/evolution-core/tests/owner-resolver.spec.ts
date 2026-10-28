// @tier fast
import { describe, expect, it } from 'vitest'
import { findOwnerCandidate, ownerCandidatesFromSummaries, type SkillSummary } from '@deepseek-ai/dsh-evolution-core'

function summary(name: string, extra: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name,
    description: name + ' description',
    path: name,
    protectedBy: null,
    protectionUnknown: false,
    managed: true,
    ...extra,
  }
}

describe('ownerCandidatesFromSummaries', () => {
  it('excludes the source and lists headings from the shared H2 scan', () => {
    const lookup = ownerCandidatesFromSummaries('source', [
      summary('source'),
      summary('owner', { whenToUse: 'publish a package', content: '# Owner\n\n## Publish\n\n## Verify\n' }),
    ])
    expect(lookup.candidates.map(candidate => candidate.name)).toEqual(['owner'])
    expect(lookup.candidates[0]?.whenToUse).toBe('publish a package')
    expect(lookup.candidates[0]?.headings).toEqual(['Publish', 'Verify'])
    expect(lookup.excluded).toEqual([{ name: 'source', reason: 'source' }])
  })

  it('names an empty-description skill in excluded instead of dropping it', () => {
    const lookup = ownerCandidatesFromSummaries('source', [summary('empty', { description: '' })])
    expect(lookup.candidates).toEqual([])
    expect(lookup.excluded).toEqual([{ name: 'empty', reason: 'unreadable' }])
  })

  it('keeps protected candidates visible and marked, and sorts by name', () => {
    const lookup = ownerCandidatesFromSummaries('source', [
      summary('zeta'),
      summary('alpha', { protectedBy: 'pinned', protectionUnknown: false }),
      summary('unknown', { protectionUnknown: true }),
    ])
    expect(lookup.candidates.map(candidate => candidate.name)).toEqual(['alpha', 'unknown', 'zeta'])
    expect(findOwnerCandidate(lookup, 'alpha')?.protectedBy).toBe('pinned')
    expect(findOwnerCandidate(lookup, 'unknown')?.protectionUnknown).toBe(true)
  })
})
