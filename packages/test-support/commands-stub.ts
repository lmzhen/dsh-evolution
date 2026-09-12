/**
 * Commands registrar stub shared by the command-surface suites: the plugin
 * registers a definition through this stub and the caller receives it.
 *
 * `assign` is called with the definition the plugin passes to `register()`, so a
 * suite keeps its own captured binding (and its declared type) instead of
 * repeating the stub body at every site.
 *
 * @param assign - receives the definition handed to `register()`.
 * @returns the `commands` service face the plugin consumes.
 */
export function captureCommands(assign: (definition: unknown) => void): { register(definition: unknown): () => void } {
  return {
    register: (definition: unknown) => {
      assign(definition)
      return () => {}
    },
  }
}
