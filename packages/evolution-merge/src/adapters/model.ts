/**
 * Structural ModelPort adapter over the platform llm service. It returns the raw text
 * (the gate and proposer own JSON extraction), so the domain never depends on a model SDK.
 */
import type { ModelPort } from '../propose.ts'

export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

export interface LlmChunkLike {
  readonly type: string
  readonly text?: string
  readonly usage?: unknown
  readonly reason?: { readonly kind?: string; readonly failure?: { readonly message?: string } }
}

export interface LlmCallLike {
  readonly config: Record<string, unknown>
  stream(input: Record<string, unknown>): AsyncIterable<LlmChunkLike>
}

export interface LlmServiceLike {
  prepareCall(config: Record<string, unknown>, signal?: AbortSignal): Promise<LlmCallLike>
}

export function createModelPort(llm: LlmServiceLike, route: () => ModelRoute): ModelPort {
  return {
    async callJson(request) {
      const selection = route()
      const call = await llm.prepareCall({
        provider: selection.provider,
        model: selection.model,
        maxTokens: request.maxTokens,
        temperature: 0,
      }, request.signal)
      let text = ''
      for await (const chunk of call.stream({
        ...call.config,
        system: request.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
        signal: request.signal,
      })) {
        if (chunk.type === 'text-delta') text += chunk.text ?? ''
        else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
          throw new Error('model call failed: ' + (chunk.reason.failure?.message ?? 'unknown'))
        }
      }
      return text
    },
  }
}
