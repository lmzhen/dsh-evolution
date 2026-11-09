/**
 * Shared registration for a view inside the single evolution workbench page.
 * A feature package owns its locale, styles and face; the workbench owns the page.
 * @module @deepseek-ai/dsh-evolution-client-kit
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { FALLBACK_LOCALE } from './panel.ts'
import type { SupportedLocale } from './generated/i18n.generated.ts'
import type { ReactNode } from 'react'

/** One feature view contribution. */
export interface WorkbenchViewSpec<Face> {
  readonly id: string
  readonly order: number
  readonly namespace: string
  readonly dictionaries: Record<SupportedLocale, Record<string, string>>
  readonly styles: { readonly css: string; readonly tagId: string }
  readonly component: (props: never) => ReactNode
  readonly face: (t: (key: string, values?: Readonly<Record<string, string | number>>) => string) => Face
}

interface WorkbenchSlots {
  inject(name: string, callback: () => Generator<() => void, void, void>): unknown
  register(options: Record<string, unknown>, component: unknown): () => void
}
interface WorkbenchSeam {
  slots: WorkbenchSlots
  locale: {
    register(namespace: string, dictionaries: Record<SupportedLocale, Record<string, string>>): () => void
    bind(namespace: string): (key: string) => string
  }
}

function injectStyles(doc: Document | undefined, css: string, tagId: string): () => void {
  if (doc === undefined) return () => {}
  const previous = doc.querySelector('style[data-plugin-css="' + tagId + '"]')
  previous?.remove()
  const tag = doc.createElement('style')
  tag.setAttribute('data-plugin-css', tagId)
  tag.textContent = css
  doc.head.appendChild(tag)
  return () => { tag.remove() }
}

/**
 * Register one view into `evolution.workbench.view`.
 * @param ctx - client cordis context.
 * @param spec - view identity, copy, styles, component and face factory.
 */
export function registerWorkbenchView<Face>(ctx: ClientContext, spec: WorkbenchViewSpec<Face>): void {
  const seam = ctx as unknown as WorkbenchSeam
  let registered = false
  ctx.effect(() => {
    try {
      const dispose = seam.locale.register(spec.namespace, spec.dictionaries)
      registered = true
      return dispose
    } catch (error) {
      ctx.logger.warn(spec.namespace + ': locale refused (' + String(error) + '); the view falls back to the bundle copy')
      return () => {}
    }
  }, spec.namespace + ': locale')
  ctx.effect(() => injectStyles(typeof document === 'undefined' ? undefined : document, spec.styles.css, spec.styles.tagId), spec.namespace + ': styles')
  const fallback = spec.dictionaries[FALLBACK_LOCALE]
  const lookup = (key: string): string => {
    const own = fallback[key] ?? key
    if (!registered) return own
    try { return seam.locale.bind(spec.namespace)(key) } catch { return own }
  }
  const t = (key: string, values?: Readonly<Record<string, string | number>>): string => {
    const template = lookup(key)
    if (values === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match: string, slot: string) => values[slot] === undefined ? match : String(values[slot]))
  }
  seam.slots.inject('evolution.workbench.view', function* () {
    yield seam.slots.register({
      name: 'evolution.workbench.view',
      id: spec.id,
      order: spec.order,
      label: () => t('entry.label'),
      inject: () => spec.face(t),
    }, spec.component)
  })
}
