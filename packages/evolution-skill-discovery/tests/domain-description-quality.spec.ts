import { describe, expect, it } from 'vitest'
import { computeDomainMetrics, descriptionHashOf, descriptionIsServable, evaluateDomainQuality, renderDomainDescription, shouldRegenerateDescription, type DomainNode, type SkillDomainEdge, type SkillKey } from '../src/index.ts'

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

describe('quality gate', () => {
  it('rejects empty, vague, overlapping and indistinguishable domains', () => {
    expect(evaluateDomainQuality(node('d', ''), []).passed).toBe(false)
    expect(evaluateDomainQuality(node('d', 'p', []), []).issues).toContain('empty-triggers')
    const peer = node('p')
    expect(evaluateDomainQuality(node('p', 'distinct purpose', ['alpha']), [peer]).issues).toContain('indistinguishable')
    expect(evaluateDomainQuality(node('d', 'another purpose', ['alpha', 'beta']), [peer]).issues).toContain('overlaps-peer')
  })
})

describe('metrics', () => {
  it('does not fake coverage when empty and reports cross/pending', () => {
    const empty = computeDomainMetrics({ mapVersion: '1', domains: [], edges: [] }, new Set())
    expect(empty.measured).toBe(false)
    expect(empty.coverage).toBeNull()
    const snapshot = { mapVersion: '1', domains: [node('d1'), node('d2'), node('d3')], edges: [edge('a', 'd1'), edge('a', 'd2', 'secondary'), edge('b', 'd1', 'primary', 'pending')] }
    const metrics = computeDomainMetrics(snapshot, new Set(['a', 'b', 'c']))
    expect(metrics.coverage).toBe(1 / 3)
    expect(metrics.unclassifiedRatio).toBe(2 / 3)
    expect(metrics.crossDomainRatio).toBe(1)
    expect(metrics.pendingRate).toBe(1 / 3)
    expect(metrics.emptyDomainCount).toBe(1)
    expect(metrics.assignmentAccuracy).toBeNull()
    expect(computeDomainMetrics(snapshot, new Set(['a']), { expectedBySkill: { a: 'd1' }, predictedBySkill: { a: 'd1' } }).assignmentAccuracy).toBe(1)
    const counted = computeDomainMetrics(snapshot, new Set(['a', 'b', 'c']), undefined, { descriptionRewritten: 1, descriptionEligible: 4, refusedAssignments: 1, assignmentAttempts: 4, maxDomainsPerSkill: 0 })
    expect(counted.descriptionRewriteRate).toBe(0.25)
    expect(counted.staleDescriptionRatio).toBe(0)
    expect(counted.refusalRate).toBe(0.25)
    expect(counted.overAssignmentRate).toBe(1 / 3)
  })
})
