import { createHash } from 'node:crypto'

/** One three-field fact supplied to the domain generator. */
export interface GenerationSkillFact {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string | undefined
}

/** Input of the initial LLM domain-generation step. */
export interface DomainGenerationInput {
  readonly skills: readonly GenerationSkillFact[]
}

/** One LLM-proposed domain; no id, no parent pointer. */
export interface GeneratedDomain {
  readonly title: string
  readonly purpose: string
  readonly inScope: readonly string[]
  readonly outOfScope: readonly string[]
  readonly triggers: readonly string[]
  readonly evidenceSkillKeys: readonly string[]
}

/** Raw LLM proposal. */
export interface DomainGenerationProposal {
  readonly domains: readonly GeneratedDomain[]
}

/** Normalized domain after code mints stable IDs. */
export interface MintedDomain extends GeneratedDomain {
  readonly id: string
}

/** Validation result; errors are stable strings for retry/observability. */
export type DomainGenerationValidation =
  | { readonly ok: true; readonly domains: readonly MintedDomain[] }
  | { readonly ok: false; readonly errors: readonly string[] }

/** @returns stable id derived from title, not the title itself. */
export function mintDomainId(title: string): string {
  return 'domain-' + createHash('sha256').update(title).digest('hex').slice(0, 12)
}

/** @returns direct for <=100 skills; prechunk-eligible above 100. */
export function domainGenerationMode(skillCount: number): 'direct' | 'prechunk-eligible' {
  if (!Number.isSafeInteger(skillCount) || skillCount < 0) throw new RangeError('skillCount must be a non-negative safe integer')
  return skillCount <= 100 ? 'direct' : 'prechunk-eligible'
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nonEmptyList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty)
}

function forbiddenKeys(value: object): string[] {
  return ['primaryParent', 'primaryParentId', 'parent', 'embedding', 'embeddingVector', 'taxonomyMethod'].filter(key => key in value)
}

/**
 * Validate an initial generation proposal and mint ids. Does not call an LLM
 * and does not read skill bodies; embedding taxonomy is rejected.
 * @param input - skills the proposal was generated from.
 * @param proposal - LLM output.
 * @returns normalized domains or stable errors.
 */
export function validateDomainGeneration(input: DomainGenerationInput, proposal: DomainGenerationProposal): DomainGenerationValidation {
  const errors: string[] = []
  if (proposal.domains.length < 8 || proposal.domains.length > 12) errors.push('domain count must be 8-12')
  const known = new Set(input.skills.map(skill => skill.name))
  const ids = new Set<string>()
  const titles = new Set<string>()
  const domains: MintedDomain[] = []
  for (const candidate of proposal.domains) {
    const bad = forbiddenKeys(candidate)
    if (bad.length > 0) errors.push('forbidden fields: ' + bad.join(','))
    if (!nonEmpty(candidate.title) || !nonEmpty(candidate.purpose)) errors.push('domain title/purpose is empty')
    if (!nonEmptyList(candidate.inScope) || !nonEmptyList(candidate.outOfScope) || !nonEmptyList(candidate.triggers)) errors.push('domain scope/triggers are empty')
    if (!Array.isArray(candidate.evidenceSkillKeys) || candidate.evidenceSkillKeys.length === 0) errors.push('domain evidence is empty')
    if (candidate.evidenceSkillKeys?.some(key => !known.has(key)) === true) errors.push('domain evidence references unknown skill')
    const id = mintDomainId(candidate.title)
    if (ids.has(id)) errors.push('duplicate minted domain id')
    if (titles.has(candidate.title)) errors.push('duplicate domain title')
    ids.add(id); titles.add(candidate.title)
    domains.push({ ...candidate, id })
  }
  if ('embedding' in proposal || 'taxonomyMethod' in proposal) errors.push('embedding taxonomy is not allowed')
  return errors.length === 0 ? { ok: true, domains } : { ok: false, errors }
}
