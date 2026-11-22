/**
 * One registration path for a sidebar panel: locale, stylesheet, row and body.
 * @module @lmzhen/dsh-evolution-client-kit
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ClientSeam, LocaleDictionaries } from './seam.ts'
import type { SupportedLocale } from './generated/i18n.generated.ts'
import { bindLocale, FALLBACK_LOCALE, type Translate } from './locale.ts'
import { injectPluginStyles } from './styles.ts'

export type { Translate } from './locale.ts'

/** The feature-specific part of one sidebar panel. */
export interface SidebarPanelSpec<Face> {
  /** The row id; the keyed main body uses the same value. */
  id: string
  /** Row order in the global panel list. */
  order: number
  /** Locale namespace owned by this panel. */
  namespace: string
  dictionaries: LocaleDictionaries
  /** Fallback dictionary when the locale seat refuses or is absent. */
  fallback?: SupportedLocale
  /** Panel stylesheet and the tag id that makes injection idempotent. */
  styles: { css: string; tagId: string }
  /** The row glyph. */
  icon: (props: { size?: number; active?: boolean }) => ReactNode
  /** The body component; the seat spreads the face as its props. */
  component: (props: never) => ReactNode
  /** The body face factory; receives the bound translator. */
  body: (t: Translate) => Face
  /** Child slots the main keyed occupant declares (the rc.3 main contract). */
  children?: Readonly<Record<string, { readonly kind: 'list' | 'keyed'; readonly scope: 'root' }>>
}

/** Fail loud when a client bundle is mounted without the shell seats it consumes. */
export function requireClientSeats(ctx: unknown, owner: string): ClientSeam {
  const candidate = ctx as Partial<ClientSeam>
  if (candidate.slots === undefined || candidate.locale === undefined) {
    throw new Error(owner + ': the client slots/locale seats are not mounted')
  }
  return candidate as ClientSeam
}

/**
 * Register one sidebar row and its main body under one lifecycle.
 * @param ctx - the client context carrying the slots and locale seats.
 * @param spec - the feature-specific row/body descriptor.
 */
export function registerSidebarPanel<Face>(ctx: ClientContext, spec: SidebarPanelSpec<Face>): void {
  const seam = ctx as unknown as ClientSeam
  ctx.effect(() => injectPluginStyles(typeof document === 'undefined' ? undefined : document, spec.styles.css, spec.styles.tagId), spec.namespace + ': styles')
  const { t, label } = bindLocale(ctx, spec.namespace, spec.dictionaries, spec.fallback ?? FALLBACK_LOCALE)

  seam.slots.inject('sidebar.panellist', function* () {
    yield seam.slots.register(
      { name: 'sidebar.panellist', id: spec.id, order: spec.order, label },
      spec.icon as (props: never) => ReactNode,
    )
    yield seam.slots.register(
      {
        name: 'main',
        key: spec.id,
        inject: (): Face => spec.body(t),
        ...(spec.children === undefined ? {} : { children: spec.children }),
      },
      spec.component,
    )
  })
}
