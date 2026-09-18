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

import type { ReactNode } from 'react'

/** Our card slot, hosted by the section this bundle registers. */
export const CARD_SLOT = 'evolution.namespace.card'

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

/** Registration options the keyed card slot under our own section takes. */
export interface SlotRegisterOptions {
  name: typeof CARD_SLOT
  /** The settings namespace this card edits — the slot's key. */
  key: string
  inject: () => unknown
}

/** Options a `settings.section` registration carries (the shell's own shape). */
export interface SectionRegisterOptions {
  name: 'settings.section'
  /** Section id; the shell derives the nav entry's DOM id from it. */
  id: string
  /** Nav order: the platform's own sections sit at 0/10/15/20. */
  order: number
  /** Lazy label: the shell re-reads it when the locale changes. */
  label: () => string
  /** Locale namespace the label and the section's copy resolve through. */
  locale: string
  /** Child slots this section hosts, declared for the shell's renderer. */
  children?: Record<string, { kind: 'keyed' | 'list' | 'single'; scope: 'root' }>
}

/**
 * The face the shell hands a section component: a translator bound to our locale
 * namespace and the renderer for the child slots we declared.
 */
export interface SectionFace {
  t: (key: string) => string
  /** Render one child slot; `filter` selects keyed entries (e.g. `{ entryKey }`). */
  renderSlot: (name: string, props?: Record<string, unknown>, filter?: Record<string, unknown>) => ReactNode
}

/** The locale seat: register this bundle's namespace, bind a translator. */
export interface LocaleSeat {
  register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(namespace: string): (key: string) => string
}

/** The slice of the client context this plugin consumes. */
export interface ClientSeam {
  slots: {
    inject(name: string, callback: () => Generator<unknown, void, unknown>): unknown
    register(options: SlotRegisterOptions | SectionRegisterOptions, component: (props: never) => unknown): () => void
  }
  settingsScope: { bind(spec: { namespace: string }): SettingsScopeLike }
  locale: LocaleSeat
}
