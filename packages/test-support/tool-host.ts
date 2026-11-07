/**
 * Family test host for the 0.2.2 tool seams.
 *
 * Tests call one tool through the batch contract and never monkeypatch
 * ToolsService. Native and PTC executors stay explicit; an absent target
 * package is a test-environment failure, not a fallback to 0.2.1 behavior.
 */
import type { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

export type ToolHostExecutor = 'native' | 'ptc'

export interface ToolHostOptions {
  readonly executor?: ToolHostExecutor
  readonly ptcRuntime?: unknown
  readonly session?: boolean
  readonly systemPrompt?: boolean
}

export interface ToolCallInput {
  readonly callId?: unknown
  readonly name: string
  readonly arguments?: unknown
  readonly agent?: unknown
  readonly signal?: AbortSignal
}

/** Mount the registry, prompt service, and exactly one target executor. */
export async function mountToolHost(ctx: Context, options: ToolHostOptions = {}): Promise<void> {
  const kind = options.executor ?? 'native'
  if (options.session !== false) await ctx.plugin(SessionStore)
  if (options.systemPrompt !== false) await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  if (kind === 'ptc' && options.ptcRuntime !== undefined) await ctx.plugin(options.ptcRuntime as never)
  const spec: string = kind === 'ptc'
    ? '@deepseek-ai/dsh-tool-executor-ptc'
    : '@deepseek-ai/dsh-tool-executor-native'
  const mod = await import(/* @vite-ignore */ spec) as { apply?: (context: Context) => void }
  if (typeof mod.apply !== 'function') throw new Error('tool-host: ' + spec + ' has no apply()')
  await ctx.plugin(mod as never)
}

/** Call one tool through the batch seam; return the inner result. */
export async function executeOne(ctx: Context, input: ToolCallInput): Promise<any> {
  const tools = ctx.get('tools') as { execute(value: unknown): Promise<{ results?: readonly { result?: unknown }[] }> } | undefined
  if (tools === undefined) throw new Error('tool-host: tools service is not mounted')
  const result = await tools.execute({
    calls: [{
      type: 'tool-call',
      id: input.callId ?? 'test-' + Math.random().toString(36).slice(2),
      name: input.name,
      arguments: typeof input.arguments === 'string' ? input.arguments : JSON.stringify(input.arguments ?? {}),
    }],
    signal: input.signal ?? new AbortController().signal,
    ...(input.agent === undefined ? {} : { agent: input.agent }),
  })
  return result.results?.[0]?.result
}

/** Call a batch and return the full target result. */
export async function executeBatch(ctx: Context, calls: readonly ToolCallInput[], options: { agent?: unknown; signal?: AbortSignal } = {}): Promise<any> {
  const tools = ctx.get('tools') as { execute(value: unknown): Promise<unknown> } | undefined
  if (tools === undefined) throw new Error('tool-host: tools service is not mounted')
  return tools.execute({
    calls: calls.map(call => ({
      type: 'tool-call',
      id: call.callId ?? 'test-' + Math.random().toString(36).slice(2),
      name: call.name,
      arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
    })),
    signal: options.signal ?? new AbortController().signal,
    ...(options.agent === undefined ? {} : { agent: options.agent }),
  })
}

/** Emit one agent-scoped inbox event through the target injection helper. */
export async function emitAgentInbox(ctx: Context, agent: unknown, name: string, payload: unknown): Promise<void> {
  const spec: string = '@deepseek-ai/dsh-agent'
  const mod = await import(/* @vite-ignore */ spec) as { emitAgentEvent?: (context: Context, target: unknown, event: string, data: unknown) => void }
  if (typeof mod.emitAgentEvent !== 'function') throw new Error('tool-host: @deepseek-ai/dsh-agent has no emitAgentEvent')
  mod.emitAgentEvent(ctx, agent, name, payload)
}
