/**
 * Structural view of the client seams this bundle uses.
 *
 * The package is distributed OUTSIDE the platform repository, so it declares the
 * seams it consumes instead of importing another plugin's values (forbidden by the
 * client bundle-purity rule) or its types (which would drag the platform sources
 * into this project). The shapes are the shell's contract: a `settings.section`
 * registration hosting a keyed card slot, the keyed `plugins.row.config` seat the
 * Plugins page opens per row, the client settings seat (`configForms`, one form per
 * Host plugin entry id), and the locale seat the section's copy resolves through.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client
 */

import type { ReactNode } from 'react'

/** Our card slot, hosted by the section this bundle registers. */
export const CARD_SLOT = 'evolution.namespace.card'

/** The Plugins page's per-row configuration seat (declared by `ui-plugin-manager`). */
export const ROW_CONFIG_SLOT = 'plugins.row.config'

/**
 * The key the Plugins page files a row's configuration under.
 *
 * Spelled here because the page's own helper cannot be imported (a value import from
 * another plugin's client half is forbidden):
 * `ui-plugin-manager/src/client/config-ledger.ts:36` is the definition this mirrors.
 * @param bundle - the bundle package name that declares the row.
 * @param rowId - the row id that bundle's patch declares.
 * @returns the `plugins.row.config` key.
 */
export function rowConfigKey(bundle: string, rowId: string): string {
  return bundle + '#' + rowId
}

/**
 * The pending-window card's slot key.
 *
 * The section pairs cards by key and the parameter cards use their settings namespace; this card has no
 * namespace (its data comes from the host's approval routes), so it carries a key of its own. The constant
 * lives HERE and not in `index.ts` because the SECTION has to name it too, and `index.ts` already imports
 * the section — one definition in the module both sides already share is what keeps that pair acyclic.
 */
export const PENDING_CARD_KEY = 'approval-pending'

/** Snapshot of one settings row, as the client seat reports it. */
export interface ParamSectionSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: Record<string, unknown> | undefined
  /** Raw user section: a key's PRESENCE marks the override, not its value. */
  user: unknown
  writable: boolean
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

/** One ordered field operation, as the client settings seat takes them. */
export interface SettingsPathOpLike {
  readonly op: 'set' | 'unset'
  readonly path: readonly string[]
  readonly value?: unknown
}

/** One row's client form state, as `configForms.get(entryId)` reports it. */
export interface ConfigFormSnapshotLike<T = Record<string, unknown>> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  /** Composition layer the Host resolved `value` over; what a cleared field reverts to. */
  base: unknown
  /** Raw user layer: a key's PRESENCE marks the override. */
  user: unknown
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

/** One row's client write face (0.2.x `configForms`). */
export interface ConfigFormLike<T = Record<string, unknown>> {
  getSnapshot(): ConfigFormSnapshotLike<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
  mutate(ops: readonly SettingsPathOpLike[], expectedRevision?: number): Promise<boolean>
}

/**
 * The client settings seat, probed rather than injected: a deployment may compose the
 * family without the settings surface, and a REQUIRED inject for a missing service
 * leaves the whole browser half pending forever (no error, no UI).
 */
export interface ConfigFormsSeat {
  /** One Host plugin entry id to its form. */
  get<T>(entryId: string): ConfigFormLike<T>
}

/** Registration options the keyed card slot under our own section takes. */
export interface SlotRegisterOptions {
  name: typeof CARD_SLOT
  /** The settings row this card edits — the slot's key. */
  key: string
  inject: () => unknown
}

/** Registration options the Plugins page's per-row config seat takes. */
export interface RowSeatRegisterOptions {
  name: typeof ROW_CONFIG_SLOT
  /** `<bundle package name>#<row id>`, as the page's ledger builds it. */
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

/**
 * The values and commands the Plugins page passes to a `plugins.row.config` entry:
 * the page owns the subscription (it re-renders the entry), so the entry renders from
 * `state` and writes through `mutate`. Both views receive this face; `summary` uses it
 * only to say whether anything is overridden.
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
      options: SlotRegisterOptions | RowSeatRegisterOptions | SectionRegisterOptions,
      component: (props: never) => unknown,
    ): () => void
  }
  locale: LocaleSeat
}
