/**
 * The LLM implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { EvolutionLlmError } from '@deepseek-ai/dsh-evolution-platform-contract'
import type { EvolutionLlmRequest, LlmPort, ModelRoute } from '@deepseek-ai/dsh-evolution-platform-contract'

export { EvolutionLlmError } from '@deepseek-ai/dsh-evolution-platform-contract'
export type {
  EvolutionLlmFailureKind,
  EvolutionLlmPurpose,
  EvolutionLlmRequest,
  LlmPort,
  ModelRoute,
} from '@deepseek-ai/dsh-evolution-platform-contract'

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
