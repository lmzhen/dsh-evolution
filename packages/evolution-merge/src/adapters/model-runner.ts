/**
 * DeepSeek judge runner over the platform llm service. The engine calls
 * runner(prompt, cfg) and expects raw model text; the platform owns provider
 * selection, usage accounting and transport.
 */
export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

export interface LlmChunkLike {
  readonly type: string
  readonly text?: string
  readonly reason?: { readonly kind?: string; readonly failure?: { readonly message?: string } }
}

export interface LlmServiceLike {
  stream?(options: Record<string, unknown>): AsyncIterable<LlmChunkLike>
  prepareCall?(config: Record<string, unknown>, signal?: AbortSignal): Promise<{ readonly config: Record<string, unknown>; stream(input: Record<string, unknown>): AsyncIterable<LlmChunkLike> }>
}

function append(chunk: LlmChunkLike, text: string): string {
  if (chunk.type === 'text-delta' || chunk.type === 'text') return text + (chunk.text ?? '')
  if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
    throw new Error('model call failed: ' + (chunk.reason.failure?.message ?? 'unknown'))
  }
  return text
}

export function createEngineRunner(llm: LlmServiceLike, route: () => ModelRoute): (prompt: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
    const selection = route()
    let text = ''
    if (llm.stream !== undefined) {
      for await (const chunk of llm.stream({
        provider: selection.provider,
        model: selection.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        temperature: 0,
      })) text = append(chunk, text)
      return text
    }
    if (llm.prepareCall === undefined) throw new Error('llm service has neither stream nor prepareCall')
    const call = await llm.prepareCall({ provider: selection.provider, model: selection.model, temperature: 0 })
    for await (const chunk of call.stream({
      ...call.config,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    })) text = append(chunk, text)
    return text
  }
}
