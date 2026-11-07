/**
 * DeepSeek judge runner over the family LLM runtime. The engine calls
 * runner(prompt, cfg) and expects raw model text; the runtime owns provider
 * selection, purpose, transport and timeout.
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { normalizeProviderKey } from '../domain/provider-key.ts'

export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

/** The runtime service surface the merge engine consumes. */
export interface EvolutionLlmLike {
  available(): boolean
  text(input: {
    readonly purpose: 'evolution-merge-engine'
    readonly route: ModelRoute
    readonly messages: ReturnType<typeof createUserMessage>[]
    readonly temperature: number
    readonly signal?: AbortSignal | undefined
    readonly timeoutMs?: number | undefined
  }): Promise<string>
}

export function createEngineRunner(llm: EvolutionLlmLike, route: () => ModelRoute): (prompt: string, cfg?: Record<string, unknown>, signal?: AbortSignal | undefined) => Promise<string> {
  return async (prompt: string, cfg?: Record<string, unknown>, runSignal?: AbortSignal | undefined): Promise<string> => {
    if (!llm.available()) throw new Error('llm service unavailable: evolutionLlm is degraded')
    const selection = route()
    const timeout = Number(cfg?.timeoutMs)
    return await llm.text({
      purpose: 'evolution-merge-engine',
      route: { provider: normalizeProviderKey(selection.provider), model: selection.model },
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
      temperature: 0,
      ...(runSignal === undefined ? {} : { signal: runSignal }),
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {}),
    })
  }
}
