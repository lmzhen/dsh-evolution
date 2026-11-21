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
  /** The platform returns the array synchronously; callers may still await a non-promise. */
  configuration?(): unknown
}
