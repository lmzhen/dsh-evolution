/**
 * Structural view of the client seams this bundle consumes. The package ships outside the
 * platform repository, so it declares the seats instead of importing platform client sources.
 */
import type { ReactNode } from 'react'

export const PANEL_ID = 'merge'
export const PANEL_ORDER = 45

export interface PanelRowOptions {
  name: 'sidebar.panellist'
  id: string
  order: number
  label: () => string
}

export interface PanelBodyOptions {
  name: 'main'
  key: string
  inject: () => unknown
}

export interface LocaleSeat {
  register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(namespace: string): (key: string) => string
}

export interface SlotsSeat {
  inject(name: string, body: () => Generator<() => void, void, void>): void
  register(options: PanelRowOptions | PanelBodyOptions, component: (props: never) => ReactNode): () => void
}

export interface ClientSeam {
  slots: SlotsSeat
  locale: LocaleSeat
}
