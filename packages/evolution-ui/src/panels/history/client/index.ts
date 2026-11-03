/**
 * Browser half: the family workbench page, starting with the history view.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSkillHistoryApi } from './api.ts'
import { createApprovalApi } from '../../settings/api.ts'
import { confirmModeFrom, type PendingCardFace } from '../../settings/PendingCard.ts'
import { fill as settingsFill, message as settingsMessage, NS as SETTINGS_NS } from '../../settings/messages.ts'
import { FALLBACKS } from '@lmzhen/dsh-evolution-client-kit/generated/fallbacks'
import { en, NS, zh } from './messages.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'
import type { PanelFace } from './Panel.ts'
import { PANEL_ORDER } from './ids.ts'
export { PANEL_ORDER }
import { WorkbenchNav, WorkbenchPage, WORKBENCH_CSS, WORKBENCH_ID, type WorkbenchFace, type WorkbenchNavFace } from './Workbench.ts'

/** Required client services: the slot registry and the locale seat. */
export const inject = ['slots', 'locale', 'layout']

interface PageSlots {
  inject(name: string, body: () => Generator<() => void, void, void>): unknown
  register(options: Record<string, unknown>, component: (props: never) => unknown): () => void
}
interface PageSeam {
  slots: PageSlots
  locale: {
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(namespace: string): (key: string) => string
  }
}

function injectStyles(documentRef: Document | undefined, css: string): () => void {
  if (documentRef === undefined) return () => {}
  const selector = 'style[data-plugin-css="' + CSS_TAG_ID + '"]'
  documentRef.querySelector(selector)?.remove()
  const tag = documentRef.createElement('style')
  tag.setAttribute('data-plugin-css', CSS_TAG_ID)
  tag.textContent = css
  documentRef.head.appendChild(tag)
  return () => { tag.remove() }
}

/**
 * Register the locale namespace, the workbench page, and its sidebar entry.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const seam = ctx as unknown as PageSeam
  const api = createSkillHistoryApi()
  let registered = false
  ctx.effect(() => {
    try {
      const dispose = seam.locale.register(NS, { zh, en })
      registered = true
      return dispose
    } catch (error) {
      ctx.logger.warn(NS + ': the locale seat refused the dictionary (' + String(error) + '); the workbench falls back to the bundle copy')
      return () => {}
    }
  }, NS + ': locale')
  ctx.effect(() => injectStyles(typeof document === 'undefined' ? undefined : document, CSS + WORKBENCH_CSS), NS + ': styles')

  const fallback = zh
  const lookup = (key: string): string => {
    const own = fallback[key] ?? key
    if (!registered) return own
    try { return seam.locale.bind(NS)(key) } catch { return own }
  }
  const t = (key: string, values?: Record<string, string | number>): string => {
    const template = lookup(key)
    if (values === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match: string, slot: string) => values[slot] === undefined ? match : String(values[slot]))
  }
  const historyFace = (): PanelFace => ({
    t,
    format: (key, values) => t(key, values),
    loadSkills: api.skills,
    loadVersions: api.versions,
    loadDiff: api.diff,
    loadBody: api.body,
    undo: api.undo,
    markdownWords: { copy: t('markdown.copy'), copied: t('markdown.copied'), footnotes: t('markdown.footnotes') },
  })
  const pendingT = (key: string, values?: Readonly<Record<string, string | number>>): string => {
    let template: string
    try { template = seam.locale.bind(SETTINGS_NS)(key) } catch { template = settingsMessage(key as never) }
    return values === undefined ? template : settingsFill(template, values)
  }
  const confirmMode = (): 'auto' | 'ask' => {
    try {
      const form = (ctx as unknown as { get?: (name: string) => unknown }).get?.('configForms') as { get?: (ns: string) => { getSnapshot?: () => { user?: unknown } } } | undefined
      return confirmModeFrom(form?.get?.('evolution-approval')?.getSnapshot?.().user)
    } catch { return 'auto' }
  }
  const pendingFace = (): PendingCardFace => ({ t: pendingT, api: createApprovalApi((input, init) => fetch(input, init)), confirmMode, fallback: FALLBACKS.approval })
  const label = (): string => t('entry.label')

  seam.slots.inject('sidebar.pages', function* () {
    yield seam.slots.register({
      name: 'sidebar.pages',
      id: WORKBENCH_ID,
      order: PANEL_ORDER,
      label,
      inject: (): WorkbenchNavFace => ({ t }),
    }, WorkbenchNav as unknown as (props: never) => unknown)
  })
  seam.slots.inject('layout.page', function* () {
    yield seam.slots.register({
      name: 'layout.page',
      key: WORKBENCH_ID,
      children: { 'evolution.workbench.view': { kind: 'list', scope: 'root' } },
      inject: (): WorkbenchFace => ({ t, history: historyFace(), pending: pendingFace() }),
    }, WorkbenchPage as unknown as (props: never) => unknown)
  })
}
