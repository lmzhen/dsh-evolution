import type { DomainMapSnapshot, DomainMapStore } from './domain-map.ts'
import { bootstrapDomainMap } from './domain-bootstrap.ts'
import type { DomainGenerationProposal } from './domain-generation.ts'
import { DOMAIN_GENERATION_PROMPT } from './domain-generation-prompt.ts'
import type { GenerationSkillFact } from './domain-generation.ts'
import type { SkillKey } from './identity.ts'

/** External LLM adapter port; discovery owns validation/persistence only. */
export interface DomainGenerationPort {
  generate(input: { readonly skills: readonly GenerationSkillFact[]; readonly prompt: string; readonly signal?: AbortSignal | undefined }): Promise<DomainGenerationProposal>
}

/**
 * Generate and persist the initial map only when the map has no domains.
 * @param store - map owner.
 * @param port - external LLM adapter.
 * @param skills - name/description/whenToUse facts.
 * @param skillKeys - evidence name -> stable key.
 * @param expectedMapVersion - CAS precondition.
 * @returns committed snapshot, or existing snapshot when already bootstrapped.
 */
export async function initialDomainMap(
  store: DomainMapStore,
  port: DomainGenerationPort,
  skills: readonly GenerationSkillFact[],
  skillKeys: Readonly<Record<string, SkillKey>>,
  expectedMapVersion: string,
  signal?: AbortSignal,
  prompt: string = DOMAIN_GENERATION_PROMPT,
): Promise<DomainMapSnapshot> {
  const current = await store.read()
  if (current.domains.length > 0) return current
  const proposal = await port.generate({ skills, prompt, ...signal === undefined ? {} : { signal } })
  return bootstrapDomainMap(store, proposal, skillKeys, expectedMapVersion)
}
