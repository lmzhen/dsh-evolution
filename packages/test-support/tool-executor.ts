import type { Context } from '@deepseek-ai/cordis'

/**
 * 0.2.2 split tool execution out of ToolsService and made execute() take a
 * batch. Family tests mount ToolRuntime directly and still call one tool at a
 * time; install the native executor, then normalize that test-only shape at
 * the executor boundary.
 */
export async function ensureNativeToolExecutor(ctx: Context): Promise<void> {
  const tools = ctx.get('tools') as { setExecutor?: (executor: unknown) => void } | undefined
  if (tools?.setExecutor === undefined) return
  const spec = '@deepseek-ai/dsh-tool-executor-native'
  try {
    const mod = await import(/* @vite-ignore */ spec) as { NativeToolExecutor?: new (context: Context) => { execute(input: unknown): Promise<unknown> } }
    if (mod.NativeToolExecutor === undefined) return
    // Patch the class once: whichever executor the testkit selected shares it.
    const proto = mod.NativeToolExecutor.prototype as unknown as {
      __evolutionLegacyExecute?: boolean
      execute(input: unknown): Promise<unknown>
    }
    if (proto.__evolutionLegacyExecute !== true) {
      proto.__evolutionLegacyExecute = true
      const originalExecute = proto.execute
      proto.execute = async function (input: unknown): Promise<unknown> {
        const one = input as { calls?: unknown; name?: unknown; callId?: unknown; id?: unknown; signal?: AbortSignal } | null
        if (one === null || typeof one !== 'object' || one.calls !== undefined || typeof one.name !== 'string') {
          return originalExecute.call(this, input)
        }
        const block = {
          type: 'tool-call' as const,
          id: one.id ?? one.callId,
          name: one.name,
          arguments: typeof (one as { arguments?: unknown }).arguments === 'string'
            ? (one as { arguments: string }).arguments
            : JSON.stringify((one as { arguments?: unknown }).arguments ?? {}),
        }
        const batch = await originalExecute.call(this, { calls: [block], signal: one.signal ?? new AbortController().signal }) as { results?: readonly unknown[] }
        return (batch.results?.[0] as { result?: unknown } | undefined)?.result
      }
    }
    const internals = tools as unknown as {
      root?: { executor?: unknown }
      scoped?: Map<unknown, { executor?: unknown }>
    }
    const existing = internals.root?.executor as { execute(input: unknown): Promise<unknown> } | undefined
    if (existing !== undefined) {
      const original = existing.execute.bind(existing)
      existing.execute = async (input: unknown) => {
        const one = input as { calls?: unknown; name?: unknown; callId?: unknown; id?: unknown; signal?: AbortSignal } | null
        if (one === null || typeof one !== 'object' || one.calls !== undefined || typeof one.name !== 'string') return original(input)
        const block = {
          type: 'tool-call' as const,
          id: one.id ?? one.callId,
          name: one.name,
          arguments: typeof (one as { arguments?: unknown }).arguments === 'string'
            ? (one as { arguments: string }).arguments
            : JSON.stringify((one as { arguments?: unknown }).arguments ?? {}),
        }
        const batch = await original({ calls: [block], signal: one.signal ?? new AbortController().signal }) as { results?: readonly unknown[] }
        return (batch.results?.[0] as { result?: unknown } | undefined)?.result
      }
    } else {
      tools.setExecutor(new mod.NativeToolExecutor(ctx))
    }
  } catch {
    // pre-0.2.2 platform: ToolsService owns execution
  }
}
