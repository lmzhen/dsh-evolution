/**
 * The LLM half of the family's host platform boundary.
 *
 * Features pass a family request (route, messages, purpose); this module owns
 * the platform GenerateOptions cast and text assembly. The purpose declaration
 * merge below is the family's contribution to the 0.2.2 request map.
 */
import type { GenerateOptions, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'

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

interface LlmRuntimeLike {
  stream?(options: GenerateOptions): AsyncIterable<StreamChunk>
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
      if (llm.stream === undefined) throw new EvolutionLlmError('transport', 'llm service has no stream()')
      yield* llm.stream(options)
    },
    ...(llm.stream === undefined ? {} : { streamRaw: (options: GenerateOptions) => llm.stream!(options) }),
    async completeText(request) {
      let text = ''
      for await (const chunk of port.stream(request)) {
        const frame = chunk as { type?: unknown; text?: unknown; reason?: { kind?: unknown; failure?: { message?: unknown; code?: unknown } } }
        if (frame.type === 'text-delta' || frame.type === 'text') text += typeof frame.text === 'string' ? frame.text : ''
        if (frame.type === 'finish' && frame.reason?.kind === 'error') {
          const failure = frame.reason.failure
          const message = failure?.message
          // rc5 delivers a refusal as an in-band finish(error) chunk, not as a thrown LlmError.
          // Preserve the decided code at the seam so callers do not retry it as transport.
          const kind = failure?.code === 'CONTENT_REFUSED' ? 'content-refused' : 'transport'
          throw new EvolutionLlmError(kind, 'model call failed: ' + (typeof message === 'string' ? message : 'unknown'))
        }
      }
      return text
    },
  }
  return port
}

/** Resolve the model route: agent-owned selection first, deployment default second. */
export function modelRoute(ctx: Context, agent?: unknown, session?: unknown): ModelRoute | undefined {
  const owned = (agent as { model?: { current?(): ModelRoute | undefined } } | undefined)?.model?.current?.()
  if (owned !== undefined) return { provider: owned.provider, model: owned.model }
  // `sessionProjections.snapshot()` returns the projection's VIEW, not its state: the platform's
  // modelSelection view is `{ lastUsed, next }` where `next` is already `pending ?? lastUsed`
  // (packages/core/agent/src/model-selection.ts, viewSchema/view). Reading the state field `pending` here would
  // always be undefined and silently pin auxiliary calls to `lastUsed`.
  if (session !== undefined) {
    const registry = ctx.get('sessionProjections') as {
      snapshot?(target: unknown, keys?: readonly string[]): { values?: Record<string, unknown> }
    } | undefined
    const value = registry?.snapshot?.(session, ['modelSelection'])?.values?.modelSelection as
      | { lastUsed?: ModelRoute | null; next?: ModelRoute | null }
      | undefined
    const chosen = value?.next ?? value?.lastUsed
    if (chosen !== undefined && chosen !== null) return { provider: chosen.provider, model: chosen.model }
  }
  const fallback = (ctx.get('agentDefaultModel') as { currentSelection?(): ModelRoute | undefined } | undefined)?.currentSelection?.()
  return fallback === undefined ? undefined : { provider: fallback.provider, model: fallback.model }
}
