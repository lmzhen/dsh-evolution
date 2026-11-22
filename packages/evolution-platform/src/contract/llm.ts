/**
 * The LLM half of the family's platform contract.
 */
import type { GenerateOptions, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'

export type EvolutionLlmFailureKind = 'model-unavailable' | 'no-route' | 'timeout' | 'cancelled' | 'content-refused' | 'transport'

/** Typed auxiliary-LLM failure; callers may map these without parsing messages. */
export class EvolutionLlmError extends Error {
  readonly kind: EvolutionLlmFailureKind
  constructor(kind: EvolutionLlmFailureKind, message: string, cause?: unknown) {
    super(message)
    this.name = 'EvolutionLlmError'
    this.kind = kind
    if (cause !== undefined) this.cause = cause
  }
}

export type EvolutionLlmPurpose =
  | 'evolution-curator'
  | 'evolution-merge-engine'
  | 'evolution-skill-discovery'

declare module '@deepseek-ai/dsh-llm/types' {
  interface LlmRequestPurposeMap {
    'evolution-curator': true
    'evolution-merge-engine': true
    'evolution-skill-discovery': true
  }
}

export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

export interface EvolutionLlmRequest {
  readonly provider: string
  readonly model: string
  readonly purpose: EvolutionLlmPurpose
  readonly messages: readonly UserMessage[]
  readonly maxTokens?: number
  readonly temperature?: number
  readonly signal?: AbortSignal
}

export interface LlmPort {
  stream(request: EvolutionLlmRequest): AsyncIterable<StreamChunk>
  completeText(request: EvolutionLlmRequest): Promise<string>
  /** Raw platform stream for features that own their full GenerateOptions (review aux path). */
  streamRaw?(options: GenerateOptions): AsyncIterable<StreamChunk>
}
