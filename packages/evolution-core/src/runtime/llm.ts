/**
 * The family's LLM runtime: one route/purpose/transport path for auxiliary
 * model calls. Feature-specific retries and parsing stay in their features.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { llmPort, modelRoute, type EvolutionLlmRequest, type LlmPort, type ModelRoute, type StreamChunk } from '../platform/index.ts'

export interface EvolutionLlmInput {
  readonly purpose: EvolutionLlmRequest['purpose']
  readonly messages: EvolutionLlmRequest['messages']
  readonly route?: ModelRoute | undefined
  readonly agent?: unknown
  readonly maxTokens?: number | undefined
  readonly temperature?: number | undefined
  readonly signal?: AbortSignal | undefined
  readonly timeoutMs?: number | undefined
}

/** Domain service for every auxiliary LLM request in the family. */
export class EvolutionLlm extends Service {
  static inject = []

  private port: LlmPort | undefined

  constructor(ctx: Context) {
    super(ctx, 'evolutionLlm')
  }

  protected [Service.init](): void {
    this.port = llmPort(this.ctx)
    if (this.port === undefined) this.ctx.logger.warn('evolution-core-runtime: llm service unavailable; model calls fail with llm-unavailable')
  }

  /** Whether the platform llm service is mounted. */
  available(): boolean { return this.port !== undefined }

  /** One assembled text response. */
  async text(input: EvolutionLlmInput): Promise<string> {
    const request = this.request(input)
    return await this.port!.completeText(request)
  }

  /** Raw chunk stream for callers that need incremental delivery. */
  stream(input: EvolutionLlmInput): AsyncIterable<StreamChunk> {
    return this.port!.stream(this.request(input))
  }

  private request(input: EvolutionLlmInput): EvolutionLlmRequest {
    const port = this.port
    if (port === undefined) throw new Error('llm-unavailable: no llm service is mounted')
    const route = input.route ?? modelRoute(this.ctx, input.agent)
    if (route === undefined) throw new Error('llm-unavailable: no model route is configured')
    const timeout = input.timeoutMs !== undefined && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? AbortSignal.timeout(input.timeoutMs)
      : undefined
    const signal = input.signal === undefined ? timeout : timeout === undefined ? input.signal : AbortSignal.any([input.signal, timeout])
    return {
      provider: route.provider,
      model: route.model,
      purpose: input.purpose,
      messages: input.messages,
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      ...(signal === undefined ? {} : { signal }),
    }
  }
}
