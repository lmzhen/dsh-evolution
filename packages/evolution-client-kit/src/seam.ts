/**
 * The client seams shared by the family's sidebar panels.
 *
 * The browser bundle keeps platform specifiers external, so these seat shapes are the
 * smallest contract the panels consume; keeping one copy prevents the three panels from
 * drifting when the platform adds a field.
 * @module @lmzhen/dsh-evolution-client-kit
 */
import type { ReactNode } from 'react'

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
  register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
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

/** One client settings row's readable/writable face (platform configForms). */
export interface ConfigFormSnapshotLike {
  status: 'loading' | 'ready' | 'unavailable'
  value: Record<string, unknown> | undefined
  writable: boolean
  revision?: number
}
export interface ConfigFormLike {
  getSnapshot(): ConfigFormSnapshotLike
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}
export interface ConfigFormsSeat { get(entryId: string): ConfigFormLike }
export interface SettingsFace {
  merge?: ConfigFormLike
  platform?: ConfigFormLike
}
