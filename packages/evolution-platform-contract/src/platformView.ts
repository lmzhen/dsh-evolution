/**
 * The remaining read-only platform surfaces the doctor's platform view uses.
 */
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
