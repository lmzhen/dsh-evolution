// @tier ci-only
import { describe, expect, it } from 'vitest'
import { descriptionHashOf, descriptionIsServable, evaluateDomainQuality, markStaleDescriptions, nextMapVersion, refreshAgedDescriptions, refreshStaleDescriptions, renderDomainDescription, shouldRegenerateDescription, type DomainMapStore, type DomainNode, type SkillDomainEdge, type SkillKey } from '../src/index.ts'

function node(id: string, purpose = 'distinct purpose', triggers: string[] = ['alpha']): DomainNode {
  return { id, name: id, purpose, description: 'old', inScope: ['alpha', 'beta'], outOfScope: ['gamma'], triggers, parentIds: [], status: 'active', version: 1, createdAt: 0, updatedAt: 0, descriptionHash: 'old', descriptionVersion: 1, descriptionStatus: 'fresh', provenance: {}, quality: {} }
}
function edge(skillKey: SkillKey, domainId: string, role: 'primary' | 'secondary' = 'primary', status: 'active' | 'pending' = 'active'): SkillDomainEdge {
  return { skillKey, domainId, role, confidence: 1, source: 'manual', skillHash: 'h', mapVersion: '1', status, assignedAt: 0 }
}

describe('description lifecycle', () => {
  it('regenerates only on structural events and keeps stale servable', () => {
    expect(shouldRegenerateDescription('skill-add')).toBe(false)
    expect(shouldRegenerateDescription('split')).toBe(true)
    expect(descriptionIsServable('stale')).toBe(true)
    expect(descriptionIsServable('failed')).toBe(false)
    const a = descriptionHashOf({ id: 'd', descriptionVersion: 1 }, [{ id: 'c1', descriptionVersion: 2 }])
    const b = descriptionHashOf({ id: 'd', descriptionVersion: 1 }, [{ id: 'c1', descriptionVersion: 3 }])
    expect(a).not.toBe(b)
    expect(renderDomainDescription(node('d'))).not.toContain('skill-')
  })
})

describe('description refresh producer', () => {
  it('marks aged fresh descriptions stale and refreshes them', async () => {
    const now = 10 * 24 * 3_600_000
    const aged = { ...node('aged'), updatedAt: now - 2 * 24 * 3_600_000 }
    let snapshot = { mapVersion: '1', domains: [aged], edges: [] as SkillDomainEdge[] }
    const store = {
      read: async () => snapshot,
      commit: async (_expected: string, next: typeof snapshot) => { snapshot = next; return next },
      rollback: async () => snapshot,
    } as DomainMapStore
    expect(await markStaleDescriptions(store, 24, now)).toBe(1)
    expect(snapshot.domains[0]!.descriptionStatus).toBe('stale')
    expect(await refreshStaleDescriptions(store)).toBe(1)
    expect(snapshot.domains[0]!.descriptionStatus).toBe('fresh')
  })
})

describe('P2-14: one version advance for the description pass', () => {
  it('uses descriptionUpdatedAt, commits once, and never writes NaN', async () => {
    const now = 10 * 24 * 3_600_000
    const edited = { ...node('edited'), updatedAt: now, descriptionUpdatedAt: now - 2 * 24 * 3_600_000 }
    let snapshot = { mapVersion: '7', domains: [edited], edges: [] as SkillDomainEdge[] }
    const commits: string[] = []
    const store = {
      read: async () => snapshot,
      commit: async (_expected: string, next: typeof snapshot) => { commits.push(next.mapVersion); snapshot = next; return next },
      rollback: async () => snapshot,
    } as DomainMapStore
    expect(await refreshAgedDescriptions(store, 24, now)).toEqual({ marked: 1, refreshed: 1 })
    expect(commits).toEqual(['8'])
    expect(snapshot.domains[0]!.descriptionUpdatedAt).toBe(now)
    expect(snapshot.domains[0]!.updatedAt).toBe(now)
    expect(nextMapVersion('custom')).toBe('custom.1')
  })
})

describe('quality gate', () => {
  it('rejects empty, vague, overlapping and indistinguishable domains', () => {
    expect(evaluateDomainQuality(node('d', ''), []).passed).toBe(false)
    expect(evaluateDomainQuality(node('d', 'p', []), []).issues).toContain('empty-triggers')
    const peer = node('p')
    expect(evaluateDomainQuality(node('p', 'distinct purpose', ['alpha']), [peer]).issues).toContain('indistinguishable')
    expect(evaluateDomainQuality(node('d', 'another purpose', ['alpha', 'beta']), [peer]).issues).toContain('overlaps-peer')
  })
})
