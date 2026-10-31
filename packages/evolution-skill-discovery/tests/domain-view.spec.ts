import { describe, expect, it } from 'vitest'
import { domainViewCounts, type DomainNode, type SkillDomainEdge, type SkillKey } from '../src/index.ts'

function n(id: string): DomainNode { return { id, name: id, purpose: 'p', description: 'd', inScope: [], outOfScope: [], triggers: [], parentIds: [], status: 'active', version: 1, createdAt: 0, updatedAt: 0, descriptionHash: 'h', descriptionVersion: 1, descriptionStatus: 'fresh', provenance: {}, quality: {} } }
function e(skillKey: SkillKey, domainId: string, role: 'primary' | 'secondary' = 'primary'): SkillDomainEdge { return { skillKey, domainId, role, confidence: 1, source: 'manual', skillHash: 'h', mapVersion: '1', status: 'active', assignedAt: 0 } }

it('counts visible members per domain and leaves unclassified virtual', () => {
  const visible = new Set<SkillKey>(['a', 'b', 'c'])
  const counts = domainViewCounts({ mapVersion: '1', domains: [n('d1')], edges: [e('a', 'd1'), e('b', 'd1'), e('b', 'd1', 'secondary'), e('c', 'd1', 'secondary')] }, visible)
  expect(counts.byDomain.get('d1')).toBe(3)
  expect(counts.unclassified).toBe(1)
  expect(domainViewCounts({ mapVersion: '1', domains: [n('d1')], edges: [e('a', 'd1')] }, visible).unclassified).toBe(2)
})
