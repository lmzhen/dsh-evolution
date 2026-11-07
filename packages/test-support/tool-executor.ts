import type { Context } from '@deepseek-ai/cordis'

/**
 * 0.2.2 split tool execution out of ToolsService. Family tests that mount
 * ToolRuntime directly (or a testkit from a line before the split) need the
 * native executor; older lines have no such package and keep their built-in
 * executor.
 */
export async function ensureNativeToolExecutor(ctx: Context): Promise<void> {
  const tools = ctx.get('tools') as { setExecutor?: (executor: unknown) => void } | undefined
  if (tools?.setExecutor === undefined) return
  const spec = '@deepseek-ai/dsh-tool-executor-native'
  try {
    const mod = await import(/* @vite-ignore */ spec) as { NativeToolExecutor?: new (context: Context) => unknown }
    if (mod.NativeToolExecutor === undefined) return
    tools.setExecutor(new mod.NativeToolExecutor(ctx))
    // 0.2.2 execute() takes a batch. Family tests still exercise one call at a
    // time; accept the legacy single-call shape and return its first result.
    const current = tools as unknown as { execute: (input: unknown, ...rest: unknown[]) => Promise<{ results?: readonly unknown[] }> }
    const execute = current.execute.bind(current)
    Object.defineProperty(tools, 'execute', {
      configurable: true,
      writable: true,
      value: async (input: unknown, ...rest: unknown[]) => {
        const one = input as { calls?: unknown; name?: unknown; callId?: unknown; id?: unknown; signal?: AbortSignal } | null
        if (one !== null && typeof one === 'object' && one.calls === undefined && typeof one.name === 'string') {
          const block = { ...one, id: one.id ?? one.callId }
          const batch = await execute({ calls: [block], signal: one.signal ?? new AbortController().signal }, ...rest)
          return batch.results?.[0] as never
        }
        return execute(input, ...rest) as never
      },
    })
  } catch {
    // pre-0.2.2 platform: ToolsService owns execution
  }
}
