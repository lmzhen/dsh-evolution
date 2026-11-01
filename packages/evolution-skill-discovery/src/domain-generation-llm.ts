import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
import { isRecord } from '@deepseek-ai/dsh-evolution-core'
import { validateDomainGeneration, type DomainGenerationProposal, type GeneratedDomain, type GenerationSkillFact } from './domain-generation.ts'
import { DOMAIN_GENERATION_PROMPT_VERSION } from './domain-generation-prompt.ts'
import type { DomainGenerationPort } from './domain-generation-service.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'evolution-skill-generation': {
      readonly kind: 'evolution-skill-generation'
      readonly form: 'notice'
      readonly summary: string
    } & ContextFormed
  }
}

/** Typed failure from LLM transport/parse/validation. */
export class DomainGenerationError extends Error {
  readonly code: 'llm-unavailable' | 'timeout' | 'invalid-output' | 'invalid-proposal'
  constructor(code: DomainGenerationError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'DomainGenerationError'
  }
}

type LlmChunk = Parameters<BlockAssembler['push']>[0]

/** Minimal platform LLM service used by the generation port. */
export interface LlmStreamService {
  stream(options: {
    readonly provider: string
    readonly model: string
    readonly messages: readonly UserMessage[]
    readonly maxTokens: number
    readonly signal?: AbortSignal | undefined
  }): AsyncIterable<LlmChunk>
}

/** @returns parsed proposal with the caller's skill set; throws on malformed/empty output. */
export function parseDomainGenerationProposal(text: string, skills: readonly GenerationSkillFact[]): DomainGenerationProposal {
  const cleaned = text.trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\`\`\`$/,'').trim()
  if (cleaned.length === 0) throw new DomainGenerationError('invalid-output', 'domain generation returned empty output')
  let parsed: unknown
  try { parsed = JSON.parse(cleaned) } catch (error) { throw new DomainGenerationError('invalid-output', 'domain generation returned non-JSON output: ' + (error instanceof Error ? error.message : String(error))) }
  const candidate = isRecord(parsed) && Array.isArray(parsed.domains) ? { domains: parsed.domains as readonly GeneratedDomain[] } : Array.isArray(parsed) ? { domains: parsed as readonly GeneratedDomain[] } : undefined
  if (candidate === undefined) throw new DomainGenerationError('invalid-output', 'domain generation output must be an object with domains[]')
  const checked = validateDomainGeneration({ skills }, candidate)
  if (!checked.ok) throw new DomainGenerationError('invalid-proposal', 'invalid domain proposal: ' + checked.errors.join('; '))
  return candidate
}

/** Production LLM adapter; validates before returning, never writes the map. */
export class LlmDomainGenerationPort implements DomainGenerationPort {
  private readonly llm: LlmStreamService
  private readonly options: { readonly provider: string; readonly model: string; readonly maxTokens: number; readonly timeoutMs: number; readonly attempts: number }

  constructor(llm: LlmStreamService, options: { readonly provider: string; readonly model: string; readonly maxTokens?: number | undefined; readonly timeoutMs?: number | undefined; readonly attempts?: number | undefined }) {
    this.llm = llm
    this.options = { provider: options.provider, model: options.model, maxTokens: options.maxTokens ?? 4096, timeoutMs: options.timeoutMs ?? 120_000, attempts: options.attempts ?? 3 }
  }

  /**
   * Generate one validated domain proposal.
   * @param input - live facts, prompt, and cancellation.
   * @returns validated proposal with 8–12 domains and known evidence.
   */
  async generate(input: { readonly skills: readonly GenerationSkillFact[]; readonly prompt: string; readonly signal?: AbortSignal | undefined }): Promise<DomainGenerationProposal> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    const signal = input.signal === undefined ? timeout : AbortSignal.any([input.signal, timeout])
    const skillContext = '\n\nAvailable skills (copy evidenceSkillKeys only from these names):\n' + input.skills.map(skill => '- ' + skill.name + ': ' + skill.description + (skill.whenToUse === undefined ? '' : ' | when: ' + skill.whenToUse)).join('\n')
    const basePrompt = input.prompt + skillContext
    let feedback = ''
    let last: DomainGenerationError | undefined
    for (let attempt = 1; attempt <= this.options.attempts; attempt += 1) {
      try {
        const prompt = feedback === '' ? basePrompt : basePrompt + '\nPrevious output was rejected: ' + feedback + '\nReturn only the structured result with 8-12 domains.'
        const assembler = new BlockAssembler()
        for await (const chunk of this.llm.stream({
          provider: this.options.provider,
          model: this.options.model,
          messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'evolution-skill-generation', form: 'notice', summary: 'initial domain generation' } })],
          maxTokens: this.options.maxTokens,
          signal,
        })) assembler.push(chunk)
        const text = assembler.blocks().filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text').map(block => block.text).join('\n')
        return parseDomainGenerationProposal(text, input.skills)
      } catch (error) {
        if (!(error instanceof DomainGenerationError) || (error.code !== 'invalid-output' && error.code !== 'invalid-proposal')) {
          if (timeout.aborted) throw new DomainGenerationError('timeout', 'domain generation timed out after ' + this.options.timeoutMs + 'ms')
          throw new DomainGenerationError('llm-unavailable', 'domain generation llm failed: ' + (error instanceof Error ? error.message : String(error)))
        }
        last = error
        feedback = error.message
      }
    }
    throw last ?? new DomainGenerationError('invalid-output', 'domain generation failed')
  }
}

export { DOMAIN_GENERATION_PROMPT_VERSION }
