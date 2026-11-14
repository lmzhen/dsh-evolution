/**
 * Shared registration for a view inside the single evolution workbench page.
 * A feature package owns its locale, styles and face; the workbench owns the page.
 * @module @deepseek-ai/dsh-evolution-client-kit
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { bindLocale } from './locale.ts'
import type { LocaleDictionaries } from './seam.ts'
import type { ReactNode } from 'react'
import { injectPluginStyles } from './styles.ts'

/** One feature view contribution. */
export interface WorkbenchViewSpec<Face> {
  readonly id: string
  readonly order: number
  readonly namespace: string
  readonly dictionaries: LocaleDictionaries
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
    register(namespace: string, dictionaries: LocaleDictionaries): () => void
    bind(namespace: string): (key: string) => string
  }
}

/**
 * Register one view into `evolution.workbench.view`.
 * @param ctx - client cordis context.
 * @param spec - view identity, copy, styles, component and face factory.
 */
export function registerWorkbenchView<Face>(ctx: ClientContext, spec: WorkbenchViewSpec<Face>): void {
  const seam = ctx as unknown as WorkbenchSeam
  ctx.effect(() => injectPluginStyles(typeof document === 'undefined' ? undefined : document, spec.styles.css, spec.styles.tagId), spec.namespace + ': styles')
  const { t } = bindLocale(ctx, spec.namespace, spec.dictionaries)
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
