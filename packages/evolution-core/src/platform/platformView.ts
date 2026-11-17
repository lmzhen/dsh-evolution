/**
 * The remaining read-only platform surfaces the doctor's platform view uses:
 * plugin manager, plugin inventory and the config editor. Each is optional and
 * each port preserves the "absent method" shape so the view reports missing
 * capabilities instead of inventing empty data.
 */
import type { Context } from '@deepseek-ai/cordis'

export interface PluginManagerPort {
  listBundles?(): Promise<unknown>
  listPlugins?(): Promise<unknown>
}

export interface PluginInventoryPort {
  list?(): Promise<unknown>
}

export interface ConfigEditorPort {
  configuration?(): Promise<unknown>
}

interface PluginManagerServiceLike {
  listBundles?(): Promise<unknown>
  listPlugins?(): Promise<unknown>
}

interface PluginInventoryServiceLike {
  list?(): Promise<unknown>
}

interface ConfigEditorServiceLike {
  configuration?(): Promise<unknown>
}

export function pluginManagerPort(ctx: Context): PluginManagerPort | undefined {
  // platform-declaration anchor: pluginManager is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('pluginManager') as PluginManagerServiceLike | undefined
  if (service === undefined) return undefined
  return {
    ...(typeof service.listBundles === 'function' ? { listBundles: () => service.listBundles!() } : {}),
    ...(typeof service.listPlugins === 'function' ? { listPlugins: () => service.listPlugins!() } : {}),
  }
}

export function pluginInventoryPort(ctx: Context): PluginInventoryPort | undefined {
  // platform-declaration anchor: pluginInventory is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('pluginInventory') as PluginInventoryServiceLike | undefined
  if (service === undefined) return undefined
  return {
    ...(typeof service.list === 'function' ? { list: () => service.list!() } : {}),
  }
}

export function configEditorPort(ctx: Context): ConfigEditorPort | undefined {
  // platform-declaration anchor: configEditor is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('configEditor') as ConfigEditorServiceLike | undefined
  if (service === undefined) return undefined
  return {
    ...(typeof service.configuration === 'function' ? { configuration: () => service.configuration!() } : {}),
  }
}
