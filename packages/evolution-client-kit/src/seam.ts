/**
 * The client seams shared by the family's sidebar panels.
 *
 * The browser bundle keeps platform specifiers external, so these seat shapes are the
 * smallest contract the panels consume; keeping one copy prevents the three panels from
 * drifting when the platform adds a field.
 * @module @lmzhen/dsh-evolution-client-kit
 */
import type { ReactNode } from 'react'
import type { SupportedLocale } from './generated/i18n.generated.ts'

/** The dictionaries a family panel registers; English is always present. */
export type LocaleDictionaries = Partial<Record<SupportedLocale, Record<string, string>>> & { en: Record<string, string> }

/** Registration options for the global sidebar row. */
export interface PanelRowOptions {
  name: 'sidebar.panellist'
  id: string
  order: number
  /** The sidebar re-reads this on every projection, so a locale switch follows. */
  label: () => string
}

/** Registration options for the main-column body dispatched by the panel id. */
export interface PanelBodyOptions {
  name: 'main'
  key: string
  /** The face handed to the component: data and callbacks only, never a service. */
  inject: () => unknown
}

/** The locale seat: one namespace registration and a bound translator. */
export interface LocaleSeat {
  register(namespace: string, dictionaries: LocaleDictionaries): () => void
  bind(namespace: string): (key: string) => string
}

/** The slot registry: an inject body may register and is disposed when it unmounts. */
export interface SlotsSeat {
  inject(name: string, body: () => Generator<() => void, void, void>): void
  register(options: PanelRowOptions | PanelBodyOptions, component: (props: never) => ReactNode): () => void
}

/** Everything a sidebar panel asks the shell for. */
export interface ClientSeam {
  slots: SlotsSeat
  locale: LocaleSeat
}

/** One atomic path operation on a config form (the platform's mutate vocabulary). */
export interface ConfigPathOpLike {
  readonly op: 'set' | 'unset'
  readonly path: readonly string[]
  readonly value?: unknown
}

/** One client settings row's readable/writable face (platform configForms). */
export interface ConfigFormSnapshotLike<T = Record<string, unknown>> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  /** Composition layer the Host resolved `value` over; what a cleared field reverts to. */
  base: unknown
  /** Raw user layer: a key's PRESENCE marks the override. */
  user: unknown
  writable: boolean
  revision: number | undefined
}
/** Why a form write was refused, as far as the host reported it. */
export type ConfigWriteKind = 'conflict' | 'validation' | 'transport'

/** One atomic write and, when it was refused, the class the host reported. */
export interface ConfigWriteOutcome {
  readonly written: boolean
  /** Absent on success; when a write was refused, why (revision CAS, invalid value, transport). */
  readonly kind?: ConfigWriteKind
}

export interface ConfigFormLike<T = Record<string, unknown>> {
  getSnapshot(): ConfigFormSnapshotLike<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
  /** Atomic multi-field save; `expectedRevision` is the read the caller is replacing. */
  mutate(ops: readonly ConfigPathOpLike[], expectedRevision?: number): Promise<boolean>
  /**
   * The same atomic save with the host's refusal class. `mutate` answers only the boolean, which
   * cannot tell "another page changed the settings" from "this value is invalid"; a card that says
   * the wrong cause is worse than saying nothing. Optional so a test double (and the previous
   * two-method face) still works.
   */
  save?(ops: readonly ConfigPathOpLike[], expectedRevision?: number): Promise<ConfigWriteOutcome>
  /** Re-read the row (used by the card's readback verdict). */
  refresh?(): Promise<void>
  /** Stop the form's remote subscription; owned by the seat. */
  dispose?(): void
}
export interface ConfigFormsSeat {
  get<T = Record<string, unknown>>(entryId: string): ConfigFormLike<T> | undefined
  /** Release every form's remote listener; called from the client effect. */
  dispose?(): void
}
export interface SettingsFace {
  merge?: ConfigFormLike
  platform?: ConfigFormLike
}
