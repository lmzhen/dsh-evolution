import type { DomainGenerationProposal, GenerationSkillFact } from './domain-generation.ts'

/** External LLM adapter port; discovery owns validation/persistence only. */
export interface DomainGenerationPort {
  generate(input: { readonly skills: readonly GenerationSkillFact[]; readonly prompt: string; readonly signal?: AbortSignal | undefined }): Promise<DomainGenerationProposal>
}
