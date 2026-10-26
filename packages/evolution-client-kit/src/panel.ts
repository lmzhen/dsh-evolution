/**
 * One registration path for a sidebar panel: locale, stylesheet, row and body.
 * @module @lmzhen/dsh-evolution-client-kit
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ClientSeam } from './seam.ts'

/** Dictionary lookup used by the panel body and row label. */
export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string

/** The feature-specific part of one sidebar panel. */
export interface SidebarPanelSpec<Face> {
  /** The row id; the keyed main body uses the same value. */
  id: string
  /** Row order in the global panel list. */
  order: number
  /** Locale namespace owned by this panel. */
  namespace: string
  dictionaries: { zh: Record<string, string>; en: Record<string, string> }
  /** Fallback dictionary when the locale seat refuses or is absent. */
  fallback?: 'zh' | 'en'
  /** Panel stylesheet and the tag id that makes injection idempotent. */
  styles: { css: string; tagId: string }
  /** The row glyph. */
  icon: (props: { size?: number; active?: boolean }) => ReactNode
  /** The body component; the seat spreads the face as its props. */
  component: (props: never) => ReactNode
  /** The body face factory; receives the bound translator. */
  body: (t: Translate) => Face
}

function interpolate(text: string, values?: Readonly<Record<string, string | number>>): string {
  if (values === undefined) return text
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''))
}

function injectStyles(doc: Document | undefined, css: string, tagId: string): () => void {
  if (doc === undefined) return () => {}
  if (doc.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return () => {}
  const tag = doc.createElement('style')
  tag.setAttribute('data-plugin-css', tagId)
  tag.textContent = css
  doc.head.append(tag)
  return () => { tag.remove() }
}

/**
 * Register one sidebar row and its main body under one lifecycle.
 * @param ctx - the client context carrying the slots and locale seats.
 * @param spec - the feature-specific row/body descriptor.
 */
export function registerSidebarPanel<Face>(ctx: ClientContext, spec: SidebarPanelSpec<Face>): void {
  const seam = ctx as unknown as ClientSeam
  let registered = false
  ctx.effect(() => {
    try {
      const dispose = seam.locale.register(spec.namespace, spec.dictionaries)
      registered = true
      return dispose
    } catch (error) {
      ctx.logger.warn(spec.namespace + ': the locale seat refused the dictionary (' + String(error) + '); the panel falls back to the bundle copy')
      return () => {}
    }
  }, spec.namespace + ': locale')
  ctx.effect(() => injectStyles(typeof document === 'undefined' ? undefined : document, spec.styles.css, spec.styles.tagId), spec.namespace + ': styles')

  const fallback = spec.dictionaries[spec.fallback ?? 'zh']
  const lookup = (key: string): string => {
    const own = fallback[key] ?? key
    if (!registered) return own
    try { return seam.locale.bind(spec.namespace)(key) } catch { return own }
  }
  const t: Translate = (key, values) => interpolate(lookup(key), values)
  const label = (): string => lookup('entry.label')

  seam.slots.inject('sidebar.panellist', function* () {
    yield seam.slots.register(
      { name: 'sidebar.panellist', id: spec.id, order: spec.order, label },
      spec.icon as (props: never) => ReactNode,
    )
    yield seam.slots.register(
      { name: 'main', key: spec.id, inject: (): Face => spec.body(t) },
      spec.component,
    )
  })
}
