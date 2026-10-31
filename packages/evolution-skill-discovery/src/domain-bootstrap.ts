import type { DomainMapSnapshot, DomainMapStore, DomainNode, SkillDomainEdge } from './domain-map.ts'
import { validateDomainGeneration, type DomainGenerationProposal } from './domain-generation.ts'
import type { SkillKey } from './identity.ts'

/**
 * Write an initial LLM domain proposal into the map. Code owns IDs and
 * validation; no embedding taxonomy and no skill body is read.
 * @param store - domain map owner.
 * @param proposal - validated 8–12 domain proposal.
 * @param skillKeys - evidence skill name -> stable skillKey.
 * @param expectedMapVersion - CAS precondition.
 * @returns committed snapshot.
 */
export async function bootstrapDomainMap(
  store: DomainMapStore,
  proposal: DomainGenerationProposal,
  skillKeys: Readonly<Record<string, SkillKey>>,
  expectedMapVersion: string,
): Promise<DomainMapSnapshot> {
  const checked = validateDomainGeneration({ skills: Object.keys(skillKeys).map(name => ({ name, description: name })) }, proposal)
  if (!checked.ok) throw new Error('invalid domain proposal: ' + checked.errors.join('; '))
  const now = Date.now()
  const domains: DomainNode[] = checked.domains.map(domain => ({
    id: domain.id, name: domain.title, purpose: domain.purpose, description: domain.purpose,
    inScope: domain.inScope, outOfScope: domain.outOfScope, triggers: domain.triggers, parentIds: [],
    status: 'provisional', version: 1, createdAt: now, updatedAt: now,
    descriptionHash: 'bootstrap', descriptionVersion: 1, descriptionStatus: 'fresh', provenance: { source: 'llm' }, quality: {},
  }))
  const primary = new Set<SkillKey>()
  const edges: SkillDomainEdge[] = []
  for (const [domainIndex, domain] of checked.domains.entries()) {
    for (const name of domain.evidenceSkillKeys) {
      const skillKey = skillKeys[name]
      if (skillKey === undefined) continue
      const role = primary.has(skillKey) ? 'secondary' : 'primary'
      if (role === 'primary') primary.add(skillKey)
      edges.push({ skillKey, domainId: checked.domains[domainIndex]!.id, role, confidence: 1, source: 'create', skillHash: 'bootstrap', mapVersion: expectedMapVersion, status: 'active', assignedAt: now })
    }
  }
  return store.commit(expectedMapVersion, { mapVersion: String(Number(expectedMapVersion) + 1), domains, edges })
}
