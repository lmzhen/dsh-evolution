/**
 * The tools implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { ToolsPort } from '@deepseek-ai/dsh-evolution-platform-contract'

export type { ToolsPort } from '@deepseek-ai/dsh-evolution-platform-contract'

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
    register: (definition, options) => tools.register(definition, options),
    guard: (guard) => tools.guard(guard),
    restrict: (filter) => tools.restrict(filter),
    get: (name, scope) => tools.get(name, scope as Parameters<ToolRuntime['get']>[1]),
    ...(typeof tools.resolve === 'function' ? { resolve: <T = unknown>(context: unknown) => tools.resolve!(context as Parameters<NonNullable<ToolRuntime['resolve']>>[0]) as Promise<T> } : {}),
    ...(typeof tools.execute === 'function' ? { execute: <T = unknown>(input: unknown) => tools.execute!(input as Parameters<NonNullable<ToolRuntime['execute']>>[0]) as Promise<T> } : {}),
  }
}

/**
 * Register one family tool through the port; a missing service yields a no-op disposer and a warning.
 * P2-4: the old silent no-op let a composition with the family rows before the platform tools row
 * load a host with no evolution tools and no diagnostic.
 */
export function registerEvolutionTool(
  ctx: Context,
  definition: ToolDefinition,
): () => void {
  const port = toolsPort(ctx)
  if (port === undefined) {
    ctx.logger.warn('evolution-adapter: tools service is not mounted; family tool "' + definition.name + '" was not registered')
    return () => {}
  }
  return port.register(definition)
}
