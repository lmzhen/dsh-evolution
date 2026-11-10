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

import type { ConfigFormLike as KitConfigFormLike, ConfigFormSnapshotLike as KitConfigFormSnapshotLike, ConfigFormsSeat as KitConfigFormsSeat, ConfigPathOpLike, LocaleSeat as KitLocaleSeat } from '@lmzhen/dsh-evolution-client-kit'

/** Structured result of one settings write, separating acceptance from readback. */
export interface SettingsSaveResult {
  readonly written: boolean
  readonly readback: 'ok' | 'failed'
  readonly kind?: 'conflict' | 'transport' | 'validation'
  readonly failure?: unknown
}

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
  reason?: 'seat-missing' | 'not-served' | 'projection-failed' | 'readback-failed' | 'transport'
  /** Last-known values are still shown; the row could not be re-read. */
  stale?: boolean
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
export type ConfigFormsSeat = KitConfigFormsSeat

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

/** Options a plugins.row.config registration carries (the Plugins page's keyed slot). */
export interface RowConfigRegisterOptions {
  name: 'plugins.row.config'
  /** The Plugins page key: <bundle package>#<row id>. */
  key: string
  order?: number
  label?: () => string
  locale?: string
}

/** The locale seat; client-kit owns the shape. */
export type LocaleSeat = KitLocaleSeat
