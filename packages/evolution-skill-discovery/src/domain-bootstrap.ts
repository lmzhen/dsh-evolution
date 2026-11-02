import { nextMapVersion, type DomainMapSnapshot, type DomainMapStore, type DomainNode, type SkillDomainEdge } from './domain-map.ts'
import type { DomainGenerationProposal, GenerationSkillFact } from './domain-generation.ts'
import { validateDomainGeneration } from './domain-generation.ts'
import type { SkillKey } from './identity.ts'

/** Real fact used by the production initial-map writer. */
export interface BootstrapSkillFact extends GenerationSkillFact {
  readonly skillKey: SkillKey
  readonly threeFieldHash: string
}

/** Provenance persisted with generated domains and edges. */
export interface BootstrapProvenance {
  readonly promptVersion: string
  readonly sourceDigest: string
  readonly model: string
  readonly runId: string
}

/**
 * Write an initial LLM proposal using live skill facts. Code owns IDs and
 * validation; no synthetic description/hash is written.
 * @param store - map owner.
 * @param proposal - 8–12 domain proposal.
 * @param facts - real rows with stable keys and three-field hashes.
 * @param expectedMapVersion - CAS precondition.
 * @param provenance - prompt/run identity for audit.
 * @returns committed snapshot.
 */
export async function bootstrapDomainMapWithFacts(
  store: DomainMapStore,
  proposal: DomainGenerationProposal,
  facts: readonly BootstrapSkillFact[],
  expectedMapVersion: string,
  provenance: BootstrapProvenance,
): Promise<DomainMapSnapshot> {
  const checked = validateDomainGeneration({ skills: facts.map(({ name, description, whenToUse }) => ({ name, description, ...whenToUse === undefined ? {} : { whenToUse } })) }, proposal)
  if (!checked.ok) throw new Error('invalid domain proposal: ' + checked.errors.join('; '))
  const byName = new Map(facts.map(fact => [fact.name, fact]))
  const now = Date.now()
  const qualityOf = (domain: typeof checked.domains[number]): Readonly<Record<string, number>> => {
    const triggerCount = domain.triggers.filter(value => value.trim() !== '').length
    const scopeCount = domain.inScope.filter(value => value.trim() !== '').length
    const duplicate = checked.domains.some(other => other.id !== domain.id && other.purpose.trim().toLowerCase() === domain.purpose.trim().toLowerCase())
    const fields = [domain.purpose.trim() !== '', triggerCount > 0, scopeCount > 0, domain.outOfScope.some(value => value.trim() !== ''), !duplicate]
    return { score: fields.filter(Boolean).length / fields.length, triggerCount, scopeCount }
  }
  const domains: DomainNode[] = checked.domains.map(domain => ({
    id: domain.id, name: domain.title, purpose: domain.purpose, description: domain.purpose,
    inScope: domain.inScope, outOfScope: domain.outOfScope, triggers: domain.triggers, parentIds: [],
    status: 'provisional', version: 1, createdAt: now, updatedAt: now,
    descriptionHash: 'bootstrap', descriptionVersion: 1, descriptionStatus: 'fresh', descriptionUpdatedAt: now,
    provenance: { source: 'llm', promptVersion: provenance.promptVersion, sourceDigest: provenance.sourceDigest, model: provenance.model, runId: provenance.runId }, quality: qualityOf(domain),
  }))
  const primary = new Set<SkillKey>()
  const edges: SkillDomainEdge[] = []
  for (const [domainIndex, domain] of checked.domains.entries()) {
    for (const name of domain.evidenceSkillKeys) {
      const fact = byName.get(name)
      if (fact === undefined) continue
      const role = primary.has(fact.skillKey) ? 'secondary' : 'primary'
      if (role === 'primary') primary.add(fact.skillKey)
      edges.push({ skillKey: fact.skillKey, domainId: checked.domains[domainIndex]!.id, role, confidence: 1, source: 'create', skillHash: fact.threeFieldHash, mapVersion: expectedMapVersion, status: 'active', assignedAt: now })
    }
  }
  return store.commit(expectedMapVersion, { mapVersion: nextMapVersion(expectedMapVersion), domains, edges })
}

/**
 * Legacy fallback for callers that only have a name -> key mapping.
 * Production must use bootstrapDomainMapWithFacts.
 */
export async function bootstrapDomainMap(
  store: DomainMapStore,
  proposal: DomainGenerationProposal,
  skillKeys: Readonly<Record<string, SkillKey>>,
  expectedMapVersion: string,
): Promise<DomainMapSnapshot> {
  const facts = Object.entries(skillKeys).map(([name, skillKey]) => ({ name, description: name, skillKey, threeFieldHash: '' }))
  return bootstrapDomainMapWithFacts(store, proposal, facts, expectedMapVersion, { promptVersion: 'legacy', sourceDigest: 'legacy', model: 'legacy', runId: 'legacy' })
}
