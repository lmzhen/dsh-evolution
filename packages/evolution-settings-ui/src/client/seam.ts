/**
 * Structural view of the client seams this bundle uses.
 *
 * The package is distributed OUTSIDE the platform repository, so it declares the
 * two seams it consumes instead of importing another plugin's values (forbidden
 * by the client bundle-purity rule) or its types (which would drag the platform
 * sources into this project). The shapes are the renderer's contract: a keyed
 * `settings.plugin.item` registration, the inject face it hands back, and the
 * per-namespace settings scope the write path fences with the revision it read.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client
 */

/** Snapshot of one settings namespace, as the client scope reports it. */
export interface ParamSectionSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: Record<string, unknown> | undefined
  /** Raw user section: a key's PRESENCE marks the override, not its value. */
  user: unknown
  writable: boolean
}

/** The reactive source the renderer binds to a `use<Name>` seat. */
export interface ParamSectionSource {
  getSnapshot(): ParamSectionSnapshot
  subscribe(listener: () => void): () => void
}

/** One namespace's write face. */
export interface SettingsScopeLike {
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** Registration options the keyed slot takes. */
export interface SlotRegisterOptions {
  name: 'settings.plugin.item'
  /** The settings namespace this card edits — the slot's key. */
  key: string
  inject: () => unknown
}

/** The slice of the client context this plugin consumes. */
export interface ClientSeam {
  slots: {
    inject(name: string, callback: () => Generator<unknown, void, unknown>): unknown
    register(options: SlotRegisterOptions, component: (props: never) => unknown): () => void
  }
  settingsScope: { bind(spec: { namespace: string }): SettingsScopeLike }
}
