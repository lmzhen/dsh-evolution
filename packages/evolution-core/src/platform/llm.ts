/**
 * The LLM half of the family's host platform boundary.
 *
 * Features pass a family request (route, messages, purpose); this module owns
 * the platform GenerateOptions cast, prepareCall fallback, and text assembly.
 * The purpose cast is the only compatibility point between the 0.2.1 fixed
 * union and 0.2.2's declaration-merge map.
 */
import type { GenerateOptions, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'

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
}

interface LlmRuntimeLike {
  stream?(options: GenerateOptions): AsyncIterable<StreamChunk>
  prepareCall?(config: GenerateOptions, signal?: AbortSignal): Promise<{
    readonly config: Record<string, unknown>
    stream(input: Record<string, unknown>): AsyncIterable<StreamChunk>
  }>
}

function toOptions(request: EvolutionLlmRequest): GenerateOptions {
  return {
    provider: request.provider,
    model: request.model,
    messages: request.messages,
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    purpose: request.purpose,
  } as unknown as GenerateOptions
}

/** Resolve the LLM port; undefined means the host has no llm service. */
export function llmPort(ctx: Context): LlmPort | undefined {
  // platform-declaration anchor: llm is declared in core PLATFORM_SERVICE_PROBES.
  const llm = ctx.get('llm') as LlmRuntimeLike | undefined
  if (llm === undefined) return undefined
  const port: LlmPort = {
    async *stream(request) {
      const options = toOptions(request)
      if (llm.stream !== undefined) {
        yield* llm.stream(options)
        return
      }
      if (llm.prepareCall !== undefined) {
        const call = await llm.prepareCall(options, request.signal)
        yield* call.stream({ ...call.config, messages: request.messages, ...(request.signal === undefined ? {} : { signal: request.signal }) })
        return
      }
      throw new Error('llm service has neither stream nor prepareCall')
    },
    async completeText(request) {
      let text = ''
      for await (const chunk of port.stream(request)) {
        const frame = chunk as { type?: unknown; text?: unknown; reason?: { kind?: unknown; failure?: { message?: unknown } } }
        if (frame.type === 'text-delta' || frame.type === 'text') text += typeof frame.text === 'string' ? frame.text : ''
        if (frame.type === 'finish' && frame.reason?.kind === 'error') {
          const message = frame.reason.failure?.message
          throw new Error('model call failed: ' + (typeof message === 'string' ? message : 'unknown'))
        }
      }
      return text
    },
  }
  return port
}

/** Resolve the model route: agent-owned selection first, deployment default second. */
export function modelRoute(ctx: Context, agent?: unknown): ModelRoute | undefined {
  const owned = (agent as { model?: { current?(): ModelRoute | undefined } } | undefined)?.model?.current?.()
  if (owned !== undefined) return { provider: owned.provider, model: owned.model }
  const fallback = (ctx.get('agentDefaultModel') as { currentSelection?(): ModelRoute | undefined } | undefined)?.currentSelection?.()
  return fallback === undefined ? undefined : { provider: fallback.provider, model: fallback.model }
}
