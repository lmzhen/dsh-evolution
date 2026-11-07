/**
 * The family's LLM runtime: one route/purpose/transport path for auxiliary
 * model calls. Feature-specific retries and parsing stay in their features.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { EvolutionLlmError, llmPort, modelRoute, type EvolutionLlmFailureKind, type EvolutionLlmRequest, type LlmPort, type ModelRoute, type StreamChunk } from '../platform/index.ts'

export interface EvolutionLlmInput {
  readonly purpose: EvolutionLlmRequest['purpose']
  readonly messages: EvolutionLlmRequest['messages']
  readonly route?: ModelRoute | undefined
  readonly agent?: unknown
  readonly session?: unknown
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
    const platform = this.ctx.get('evolutionPlatform') as { ports?: { llm?: import('../platform/llm.ts').LlmPort } } | undefined
    this.port = platform?.ports?.llm ?? llmPort(this.ctx)
    if (this.port === undefined) this.ctx.logger.warn('evolution-core-runtime: llm service unavailable; model calls fail with llm-unavailable')
  }

  /** Whether the platform llm service is mounted. */
  available(): boolean { return this.port !== undefined }

  /** One assembled text response. */
  async text(input: EvolutionLlmInput): Promise<string> {
    const prepared = this.prepare(input)
    try {
      return await prepared.port.completeText(prepared.request)
    } catch (error) {
      throw this.classify(error, prepared.timeout, prepared.caller)
    }
  }

  /** Raw chunk stream for callers that need incremental delivery. */
  async *stream(input: EvolutionLlmInput): AsyncIterable<StreamChunk> {
    const prepared = this.prepare(input)
    try {
      yield* prepared.port.stream(prepared.request)
    } catch (error) {
      throw this.classify(error, prepared.timeout, prepared.caller)
    }
  }

  private prepare(input: EvolutionLlmInput): { port: LlmPort; request: EvolutionLlmRequest; timeout?: AbortSignal; caller?: AbortSignal } {
    const port = this.port
    if (port === undefined) throw new EvolutionLlmError('model-unavailable', 'llm-unavailable: no llm service is mounted')
    const route = input.route ?? modelRoute(this.ctx, input.agent, input.session)
    if (route === undefined) throw new EvolutionLlmError('no-route', 'llm-unavailable: no model route is configured')
    const timeout = input.timeoutMs !== undefined && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? AbortSignal.timeout(input.timeoutMs)
      : undefined
    const signal = input.signal === undefined ? timeout : timeout === undefined ? input.signal : AbortSignal.any([input.signal, timeout])
    const request: EvolutionLlmRequest = {
      provider: route.provider,
      model: route.model,
      purpose: input.purpose,
      messages: input.messages,
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      ...(signal === undefined ? {} : { signal }),
    }
    return { port, request, ...(timeout === undefined ? {} : { timeout }), ...(input.signal === undefined ? {} : { caller: input.signal }) }
  }

  private classify(error: unknown, timeout: AbortSignal | undefined, caller: AbortSignal | undefined): EvolutionLlmError {
    if (error instanceof EvolutionLlmError) return error
    const kind: EvolutionLlmFailureKind = timeout?.aborted === true ? 'timeout' : caller?.aborted === true ? 'cancelled' : 'transport'
    return new EvolutionLlmError(kind, error instanceof Error ? error.message : String(error), error)
  }
}
