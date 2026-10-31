// @tier ci-only
import { describe, expect, it } from 'vitest'
import { auditDomainMap, coarsenCandidates, splitCandidates, type DomainMapSnapshot, type DomainNode, type SkillDomainEdge } from '../src/index.ts'

function node(id: string, parentIds: string[] = []): DomainNode { return { id, name: id, purpose: 'purpose', description: 'd', inScope: ['a'], outOfScope: ['b'], triggers: ['t'], parentIds, status: 'active', version: 1, createdAt: 0, updatedAt: 3, descriptionHash: 'h', descriptionVersion: 1, descriptionStatus: 'fresh', provenance: {}, quality: {} } }
function edge(skillKey: string, domainId: string, role: 'primary' | 'secondary' = 'primary'): SkillDomainEdge { return { skillKey, domainId, role, confidence: 1, source: 'manual', skillHash: 'h', mapVersion: '1', status: 'active', assignedAt: 0 } }
function map(domains: DomainNode[], edges: SkillDomainEdge[]): DomainMapSnapshot { return { mapVersion: '1', domains, edges } }

describe('G5 maintenance audit', () => {
  it('counts direct/indirect/empty/orphan and unclassified without fake coverage', () => {
    const audit = auditDomainMap(map([node('root'), node('child', ['root']), node('orphan', ['missing']), node('empty')], [edge('a', 'root'), edge('b', 'child'), edge('c', 'root')]), new Set(['a', 'b', 'c', 'd']))
    expect(audit.domainCount).toBe(4)
    expect(audit.unclassifiedCount).toBe(1)
    const root = audit.domains.find(item => item.domainId === 'root')
    expect(root).toMatchObject({ childCount: 1, directSkillCount: 2, indirectSkillCount: 1, empty: false, orphan: false })
    expect(audit.domains.find(item => item.domainId === 'child')?.directSkillCount).toBe(1)
    expect(audit.domains.find(item => item.domainId === 'empty')?.empty).toBe(true)
    expect(audit.domains.find(item => item.domainId === 'orphan')?.orphan).toBe(true)
  })

  it('returns split/coarsen candidates without applying them', () => {
    const six = Array.from({ length: 6 }, (_, index) => edge('s' + index, 'big'))
    const split = splitCandidates(map([node('big')], six), 6)
    expect(split[0]).toMatchObject({ domainId: 'big', directSkillCount: 6, children: 2, blockers: [] })
    const domains = Array.from({ length: 13 }, (_, index) => node('d' + index))
    const coarse = coarsenCandidates(map(domains, []), 12)
    expect(coarse.length).toBeGreaterThanOrEqual(2)
    for (const group of coarse) { expect(group.domainIds.length).toBeGreaterThanOrEqual(3); expect(group.domainIds.length).toBeLessThanOrEqual(8) }
    expect(coarsenCandidates(map(domains.slice(0, 12), []), 12)).toEqual([])
    expect(splitCandidates(map([node('big')], []), 25)).toEqual([])
  })
})
