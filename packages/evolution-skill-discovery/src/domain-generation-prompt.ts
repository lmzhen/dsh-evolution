import { createHash } from 'node:crypto'

/** Frozen initial domain-generation prompt; caller owns schema/IDs. */
export const DOMAIN_GENERATION_PROMPT_VERSION = 'v2'

export const DOMAIN_GENERATION_PROMPT_V1 = `Group the provided skills into first-level domains.
Use only name, description, and whenToUse; do not infer from skill bodies.
Produce 8–12 domains that are coherent, distinct, task-recognizable, and useful as an awareness layer. A single skill is not a domain. Each domain has a name, one-sentence purpose, in-scope, out-of-scope, triggers, and evidence skill names that actually support it.
Prefer clear boundaries over exhaustive coverage. If the evidence is weak, leave the skill unassigned rather than forcing it into a domain. Together the domains should cover the library where evidence supports it. Domain IDs are assigned by the caller.
Return only the structured result.`

export interface DomainGenerationPromptOptions {
  readonly minDomains?: number
  readonly maxDomains?: number
}

/** @returns a parameterized initial-domain prompt; default 8–12. */
export function buildDomainGenerationPrompt(options: DomainGenerationPromptOptions = {}): string {
  const requestedMin = options.minDomains ?? 8
  const requestedMax = options.maxDomains ?? 12
  const valid = Number.isSafeInteger(requestedMin) && Number.isSafeInteger(requestedMax) && requestedMin >= 2 && requestedMax >= requestedMin && requestedMax <= 20
  const min = valid ? requestedMin : 8
  const max = valid ? requestedMax : 12
  return `You are designing a first-level domain map for a skill library.
Input is limited to each skill's name, description, and whenToUse; do not infer from skill bodies.
Choose ${min}–${max} domains that help a model decide where to look. Domains are an awareness layer, not a complete taxonomy.
Each domain needs a name, one-sentence purpose, in-scope, out-of-scope, triggers, and evidence skill names copied from the input.
Keep domains coherent, distinguishable, and recognizable from a task description; a single skill is not a domain. Do not invent skills or domains.
Prefer clear boundaries over exhaustive coverage. Leave a skill unassigned when evidence is weak rather than forcing it. The caller assigns IDs.
Return only the structured result.`
}

export const DOMAIN_GENERATION_PROMPT_V2 = buildDomainGenerationPrompt()

export const DOMAIN_GENERATION_PROMPT_HASH = createHash('sha256').update(DOMAIN_GENERATION_PROMPT_V2, 'utf8').digest('hex')

/** Active prompt; v1 remains frozen for traceability. */
export const DOMAIN_GENERATION_PROMPT = DOMAIN_GENERATION_PROMPT_V2
