/**
 * Structural view of the client seams this bundle uses.
 *
 * The package is distributed OUTSIDE the platform repository, so it declares the
 * seams it consumes instead of importing another plugin's values (forbidden by the
 * client bundle-purity rule) or its types (which would drag the platform sources
 * into this project). The shapes are the shell's contract: a `settings.section`
 * registration hosting a keyed card slot, the client settings seat (`configForms`,
 * one form per Host plugin entry id), and the locale seat the section's copy resolves through.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client
 */

import type { ReactNode } from 'react'
import type { ConfigFormLike as KitConfigFormLike, ConfigFormSnapshotLike as KitConfigFormSnapshotLike, ConfigPathOpLike } from '@lmzhen/dsh-evolution-client-kit'

/** Our card slot, hosted by the section this bundle registers. */
export const CARD_SLOT = 'evolution.namespace.card'

/**
 * The pending-window card's slot key.
 *
 * The section pairs cards by key and the parameter cards use their settings namespace; this card has no
 * namespace (its data comes from the host's approval routes), so it carries a key of its own. The constant
 * lives HERE and not in `index.ts` because the SECTION has to name it too, and `index.ts` already imports
 * the section — one definition in the module both sides already share is what keeps that pair acyclic.
 */
export const PENDING_CARD_KEY = 'approval-pending'

/** The diagnostics card's slot key: read-only, no settings namespace (its data comes from HOST_ROUTES.diagnostics). */
export const DIAGNOSTICS_CARD_KEY = 'diagnostics'

/** Snapshot of one settings row, as the client seat reports it. */
export interface ParamSectionSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: Record<string, unknown> | undefined
  /** Raw user section: a key's PRESENCE marks the override, not its value. */
  user: unknown
  writable: boolean
  /** U-5: the composition layer a cleared field reverts to (platform `base`, previously dropped). */
  base: Record<string, unknown> | undefined
  /**
   * Why an `unavailable` snapshot is unavailable: this bundle found no settings seat at
   * all, or the seat is there and serves no such row. The two read differently to the
   * operator (one is the UI's own gap, the other is a row that is not composed).
   */
  reason?: 'seat-missing' | 'not-served' | 'projection-failed'
}

/** The reactive source the renderer binds to a `use<Name>` seat. */
export interface ParamSectionSource {
  getSnapshot(): ParamSectionSnapshot
  subscribe(listener: () => void): () => void
  /**
   * T5-11/A66: the seat ARRIVED (or was replaced) — bind it and wake every listener.
   *
   * The source re-probes on every READ, which covers a card that has not rendered yet; it does not
   * cover a card that already rendered its "no settings surface" state, because nothing tells React to
   * read again. `ctx.inject` is the platform's own arrival channel (it runs the callback when the
   * service appears and re-runs it when the service changes), so the bundle subscribes there instead of
   * inventing a timer.
   */
  revive(): void
}

/** One ordered field operation; client-kit owns the shape. */
export type SettingsPathOpLike = ConfigPathOpLike

/** One row's client form state; client-kit owns the shape. */
export type ConfigFormSnapshotLike<T = Record<string, unknown>> = KitConfigFormSnapshotLike<T>

/** One row's client write face; client-kit owns the shape. */
export type ConfigFormLike<T = Record<string, unknown>> = KitConfigFormLike<T>

/**
 * The client settings seat, probed rather than injected: a deployment may compose the
 * family without the settings surface, and a REQUIRED inject for a missing service
 * leaves the whole browser half pending forever (no error, no UI).
 */
export interface ConfigFormsSeat {
  /** One Host plugin entry id to its form. */
  get<T>(entryId: string): ConfigFormLike<T> | undefined
}

/** Registration options the keyed card slot under our own section takes. */
export interface SlotRegisterOptions {
  name: typeof CARD_SLOT
  /** The settings row this card edits — the slot's key. */
  key: string
  inject: () => unknown
}

/** Registration options the platform's Plugins list takes for one parameter card. */
export interface PluginItemRegisterOptions {
  name: 'settings.plugin.item'
  id: string
  order: number
  locale: string
  inject: () => unknown
}

/** Options a `settings.plugins.tab` contribution carries (rc.3 plugin settings page). */
export interface PluginsTabRegisterOptions {
  name: 'settings.plugins.tab'
  id: string
  order: number
  label: () => string
  locale: string
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

/**
 * The face the test helper uses to render a parameter card with a page-owned form:
 * the helper renders from `state` and writes through `mutate`.
 */
export interface RowConfigViewProps {
  /** `summary` is the row's one-line description fallback; `page` is the whole form. */
  readonly view: 'summary' | 'page'
  /** Absent when the Host serves no configuration for this row. */
  readonly form?: RowConfigForm | undefined
}

/** The row form the page derived from its settings seat. */
export interface RowConfigForm {
  readonly state: ConfigFormSnapshotLike
  readonly mutate: (ops: readonly SettingsPathOpLike[], revision?: number) => Promise<boolean>
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
    register(
      options: SlotRegisterOptions | PluginItemRegisterOptions | PluginsTabRegisterOptions | SectionRegisterOptions,
      component: (props: never) => unknown,
    ): () => void
  }
  locale: LocaleSeat
}
