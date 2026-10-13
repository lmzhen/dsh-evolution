/**
 * Structural view of the client seams this bundle consumes: the sidebar's global panel row, the
 * main-column body it addresses, the slot registry and the locale seat.
 *
 * The package ships outside the platform repository, so it DECLARES the seams it uses instead of
 * importing another plugin's values (forbidden by the client bundle purity rule) or its types
 * (which would drag platform client sources in). The shapes below are the shell's contract:
 * `sidebar.panellist` takes `id`/`order`/`label` and owns the button and the layout, while the body
 * is the root layout's keyed `main` slot dispatched by that SAME id.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */

import type { ReactNode } from 'react'

/** The panel id. The row and the `main` body MUST share it: the sidebar resolves the body by it. */
export const PANEL_ID = 'skill-health'

/** Row order inside the global panel list: beside the skill-history row (35), after it. */
export const PANEL_ORDER = 40

/** Registration options for the global panel row (the sidebar's own shape). */
export interface PanelRowOptions {
  name: 'sidebar.panellist'
  id: string
  order: number
  /** Lazy label: the sidebar re-reads it on every projection, so the locale can change underneath. */
  label: () => string
}

/** Registration options for the main-column body: a keyed slot dispatched by sidebar entry id. */
export interface PanelBodyOptions {
  name: 'main'
  key: string
  /** The face handed to the component: plain data and callbacks, never a service. */
  inject: () => unknown
}

/** The locale seat: register this bundle's namespace, bind a translator. */
export interface LocaleSeat {
  register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(namespace: string): (key: string) => string
}

/** The slot registry: a generator body may register (and is disposed when it unmounts). */
export interface SlotsSeat {
  inject(name: string, body: () => Generator<() => void, void, void>): void
  register(options: PanelRowOptions | PanelBodyOptions, component: (props: never) => ReactNode): () => void
}

/** Everything this bundle asks the shell for. */
export interface ClientSeam {
  slots: SlotsSeat
  locale: LocaleSeat
}
