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
    if (mod.NativeToolExecutor !== undefined) tools.setExecutor(new mod.NativeToolExecutor(ctx))
  } catch {
    // pre-0.2.2 platform: ToolsService owns execution
  }
}
