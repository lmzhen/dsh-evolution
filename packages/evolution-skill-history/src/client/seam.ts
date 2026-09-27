/**
 * Structural view of the two client seams this bundle uses: the sidebar
 * global panel row plus the main-column body it addresses, and the locale seat.
 *
 * The package is distributed outside the platform repository, so it declares the seams it consumes
 * instead of importing another plugin's values (forbidden by the client bundle purity rule) or its
 * types (which would drag platform client sources into this project). The shapes are the shell's
 * contract: `sidebar.panellist` takes `id`/`order`/`label` and the sidebar owns the button, while the body is the
 * root layout's keyed `main` slot dispatched by that same id.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */

import type { ReactNode } from 'react'

/** The panel id. The icon row and the `main` body MUST share it: the sidebar resolves the body by it. */
export const PANEL_ID = 'skill-history'

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

/** The slice of the client context this plugin consumes. */
export interface ClientSeam {
  slots: {
    inject(name: string, callback: () => Generator<unknown, void, unknown>): unknown
    register(options: PanelRowOptions | PanelBodyOptions, component: (props: never) => ReactNode): () => void
  }
  locale: LocaleSeat
}
