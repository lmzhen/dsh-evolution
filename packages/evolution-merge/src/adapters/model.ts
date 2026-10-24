/**
 * Structural ModelPort adapter over the platform llm service. The platform exposes either
 * `stream()` (the current shape) or the older prepareCall()/stream pair; both return raw text
 * because the gate and proposer own JSON extraction.
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
  prepareCall?(config: Record<string, unknown>, signal?: AbortSignal): Promise<LlmCallLike>
  stream?(options: Record<string, unknown>): AsyncIterable<LlmChunkLike>
}

function append(chunk: LlmChunkLike, text: string): string {
  if (chunk.type === 'text-delta' || chunk.type === 'text') return text + (chunk.text ?? '')
  if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
    throw new Error('model call failed: ' + (chunk.reason.failure?.message ?? 'unknown'))
  }
  return text
}

export function createModelPort(llm: LlmServiceLike, route: () => ModelRoute): ModelPort {
  return {
    async callJson(request) {
      const selection = route()
      let text = ''
      if (llm.stream !== undefined) {
        for await (const chunk of llm.stream({
          provider: selection.provider,
          model: selection.model,
          system: request.system,
          messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
          maxTokens: request.maxTokens,
          temperature: 0,
          signal: request.signal,
        })) text = append(chunk, text)
        return text
      }
      if (llm.prepareCall === undefined) throw new Error('llm service has neither stream nor prepareCall')
      const call = await llm.prepareCall({
        provider: selection.provider,
        model: selection.model,
        maxTokens: request.maxTokens,
        temperature: 0,
      }, request.signal)
      for await (const chunk of call.stream({
        ...call.config,
        system: request.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
        signal: request.signal,
      })) text = append(chunk, text)
      return text
    },
  }
}
