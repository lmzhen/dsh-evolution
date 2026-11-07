import type { DomainGenerationPort } from './domain-generation-service.ts'
import { DomainGenerationError, LlmDomainGenerationPort, type LlmTextService } from './domain-generation-llm.ts'
import { bootstrapFactsFromRows } from './generation-input.ts'
import type { GenerationRequest } from './domain-generation-coordinator.ts'
import type { SkillIndexRow } from './identity.ts'

/** Inputs for the production generation port composition. */
export interface GenerationCompositionInput {
  readonly mode: 'off' | 'on'
  readonly llm?: LlmTextService | undefined
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number | undefined
  readonly timeoutMs?: number | undefined
  readonly attempts?: number | undefined
}

/**
 * Resolve the production port; mode:on without an llm service fails loud.
 * @param input - mode and concrete llm service.
 * @returns port, or undefined for mode:off.
 */
export function resolveGenerationPort(input: GenerationCompositionInput): DomainGenerationPort | undefined {
  if (input.mode === 'off') return undefined
  if (input.llm === undefined) throw new DomainGenerationError('llm-unavailable', 'evolution-skill-discovery: mode=' + input.mode + ' requires an llm service for initial domain generation')
  return new LlmDomainGenerationPort(input.llm, {
    provider: input.provider,
    model: input.model,
    ...input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens },
    ...input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs },
    ...input.attempts === undefined ? {} : { attempts: input.attempts },
  })
}

/** Inputs for a map-scope generation request built from one live view. */
export interface GenerationRequestInput {
  readonly mapScope: string
  readonly sourceDigest: string
  readonly mapVersion: string
  readonly rows: readonly SkillIndexRow[]
  readonly prompt: string
  readonly promptVersion: string
  readonly model: string
  readonly runId: string
}

/**
 * Build a global-map generation request from live rows.
 * @param input - map scope, source identity, rows, and prompt.
 * @returns request with real facts; never reads config arrays.
 */
export function buildGenerationRequest(input: GenerationRequestInput): GenerationRequest {
  return {
    mapScope: input.mapScope,
    sourceDigest: input.sourceDigest,
    expectedMapVersion: input.mapVersion,
    facts: bootstrapFactsFromRows(input.rows),
    prompt: input.prompt,
    promptVersion: input.promptVersion,
    model: input.model,
    runId: input.runId,
  }
}
