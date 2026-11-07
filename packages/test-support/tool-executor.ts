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
    // A testkit may already have registered the sole executor; setExecutor refuses
    // a second one. Wrap that instance when present.
    const internals = tools as unknown as {
      root?: { executor?: { execute(input: unknown): Promise<unknown> } }
      scoped?: Map<unknown, { executor?: { execute(input: unknown): Promise<unknown> } }>
    }
    const existing = internals.root?.executor ?? internals.scoped?.values().next().value?.executor
    const executor = existing ?? new mod.NativeToolExecutor(ctx)
    const execute = executor.execute.bind(executor)
    executor.execute = async (input: unknown) => {
      const one = input as { calls?: unknown; name?: unknown; callId?: unknown; id?: unknown; signal?: AbortSignal } | null
      if (one === null || typeof one !== 'object' || one.calls !== undefined || typeof one.name !== 'string') {
        return execute(input)
      }
      const block = { ...one, id: one.id ?? one.callId }
      const batch = await execute({ calls: [block], signal: one.signal ?? new AbortController().signal }) as { results?: readonly unknown[] }
      return batch.results?.[0]
    }
    if (existing === undefined) tools.setExecutor(executor)
  } catch {
    // pre-0.2.2 platform: ToolsService owns execution
  }
}
