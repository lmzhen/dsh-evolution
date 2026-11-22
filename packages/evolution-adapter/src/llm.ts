/**
 * The LLM implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { EvolutionLlmError } from './contract/index.ts'
import type { EvolutionLlmRequest, LlmPort, ModelRoute } from './contract/index.ts'

export { EvolutionLlmError } from './contract/index.ts'
export type {
  EvolutionLlmFailureKind,
  EvolutionLlmPurpose,
  EvolutionLlmRequest,
  LlmPort,
  ModelRoute,
} from './contract/index.ts'

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
      let finished = false
      for await (const chunk of port.stream(request)) {
        const frame = chunk as { type?: unknown; text?: unknown; reason?: { kind?: unknown; failure?: { message?: unknown; code?: unknown } } }
        if (frame.type === 'text-delta') text += typeof frame.text === 'string' ? frame.text : ''
        if (frame.type !== 'finish') continue
        finished = true
        const reason = frame.reason
        if (reason?.kind === 'stop' || reason?.kind === 'tool-calls' || reason?.kind === 'max-tokens') break
        if (reason?.kind === 'aborted') {
          const failure = reason.failure
          throw new EvolutionLlmError('cancelled', 'model call aborted', failure)
        }
        if (reason?.kind === 'error') {
          const failure = reason.failure
          const message = typeof failure?.message === 'string' ? failure.message : 'unknown'
          const code = typeof failure?.code === 'string' ? failure.code : ''
          // rc5 delivers a refusal as an in-band finish(error) chunk, not as a thrown LlmError.
          // Preserve the decided code at the seam so callers do not retry it as transport.
          if (code === 'CONTENT_REFUSED') throw new EvolutionLlmError('content-refused', 'model call failed: ' + message, failure)
          if (code === 'TIMEOUT') throw new EvolutionLlmError('timeout', 'model call timed out: ' + message, failure)
          if (/^(NO_ADAPTER|NO_DISCOVERY|MISSING_CREDENTIAL|INVALID_CREDENTIAL|AUTH|UNKNOWN_MODEL)$/.test(code)) {
            throw new EvolutionLlmError('no-route', 'model route unavailable: ' + message, failure)
          }
          if (/^(ACCOUNT_|QUOTA|RATE_LIMIT)/.test(code)) throw new EvolutionLlmError('model-unavailable', 'model unavailable: ' + message, failure)
          throw new EvolutionLlmError('transport', 'model call failed: ' + message, failure)
        }
        // FinishReasonMap is merge-extensible; an unknown terminal kind is not a success.
        throw new EvolutionLlmError('transport', 'model call ended with an unknown finish reason')
      }
      if (!finished) throw new EvolutionLlmError('transport', 'model stream ended without a finish frame')
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
