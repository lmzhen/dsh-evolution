/**
 * The tools half of the family's host platform boundary.
 *
 * Only this module imports @deepseek-ai/dsh-tools; consumers receive a typed
 * port and never reshape ctx.get('tools') themselves. Missing service is a
 * capability downgrade, not a crash.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ToolDefinition,
  ToolGuard,
  ToolRestriction,
  ToolRuntime,
} from '@deepseek-ai/dsh-tools'

/** The subset of the platform tools registry the family consumes. */
export interface ToolsPort {
  register(definition: ToolDefinition): () => void
  guard(guard: ToolGuard): () => void
  restrict(filter: ToolRestriction): () => void
  /** The visible tool under this scope, or undefined; the opt-in probe reads this. */
  get(name: string, scope?: unknown): unknown
  /** Raw execute for callers that own the platform call shape (review aux path). */
  execute?<T = unknown>(input: unknown): Promise<T>
}

/**
 * Resolve the tools port from a context; undefined means the host has no tools service.
 * platform-declaration anchor: tools is declared in core PLATFORM_SERVICE_PROBES.
 */
export function toolsPort(ctx: Context): ToolsPort | undefined {
  // The cast is confined to the boundary: the platform service class is the
  // contract, while the port keeps feature code independent of its full face.
  const tools = ctx.get('tools') as ToolRuntime | undefined
  if (tools === undefined) return undefined
  return {
    register: (definition) => tools.register(definition),
    guard: (guard) => tools.guard(guard),
    restrict: (filter) => tools.restrict(filter),
    get: (name, scope) => tools.get(name, scope as Parameters<ToolRuntime['get']>[1]),
    ...(typeof tools.execute === 'function' ? { execute: <T = unknown>(input: unknown) => tools.execute!(input as Parameters<NonNullable<ToolRuntime['execute']>>[0]) as Promise<T> } : {}),
  }
}

/** Register one family tool through the port; a missing service yields a no-op disposer. */
export function registerEvolutionTool(
  ctx: Context,
  definition: ToolDefinition,
): () => void {
  return toolsPort(ctx)?.register(definition) ?? (() => {})
}

