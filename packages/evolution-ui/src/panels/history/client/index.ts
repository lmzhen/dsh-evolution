/**
 * Browser half: the family workbench page, starting with the history view.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import { createSkillHistoryApi } from './api.ts'
import { createApprovalApi } from '../../settings/api.ts'
import { fetchMergePendingCount, registerSurface, PAGE_SURFACE_CSS, type ConfigFormLike, type ConfigFormsSeat, type Translate } from '@lmzhen/dsh-evolution-client-kit'
import { confirmModeFrom, type PendingCardFace } from '../../settings/PendingCard.ts'
import { dictionaries as settingsDictionaries, NS as SETTINGS_NS } from '../../settings/messages.ts'
import { bindLocale } from '@lmzhen/dsh-evolution-client-kit'
import { FALLBACKS } from '@lmzhen/dsh-evolution-client-kit/generated/fallbacks'
import { NS, dictionaries } from './messages.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'
import type { PanelFace } from './Panel.ts'
import { PANEL_ORDER } from './ids.ts'
export { PANEL_ORDER }
import { WorkbenchIcon, WorkbenchPage, WORKBENCH_CSS, WORKBENCH_ID, type WorkbenchFace } from './Workbench.ts'
import { createWorkbenchStore, type WorkbenchTaskCounts } from './WorkbenchStore.ts'

/** Required client services: the slot registry and the locale seat. */
export const inject = ['slots', 'locale']

/**
 * Register the locale namespace, the workbench main occupant and its sidebar row.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const api = createSkillHistoryApi()
  // The platform settings shell owns this seat; read it lazily (the history panel may activate
  // before the shell exists) and never dispose it (it is not ours).
  const settingsSeat = (): ConfigFormsSeat | undefined => (ctx as unknown as { get?: (name: string) => unknown }).get?.('configForms') as ConfigFormsSeat | undefined
  // U-6: the form's `value` is the schema-resolved section (the effective word); `user`
  // only says whether the operator overrode it. Read the effective value so the display
  // and the click behavior cannot disagree, and keep a subscription so a settings write
  // re-renders the pending card instead of changing a bare variable.
  let approvalForm: ConfigFormLike | undefined
  let stopApprovalWatch: (() => void) | undefined
  const approvalListeners = new Set<() => void>()
  const notifyApproval = (): void => { for (const listener of approvalListeners) listener() }
  const bindApprovalSeat = (seat?: ConfigFormsSeat): void => {
    const next = seat?.get('evolution-approval')
    if (next === approvalForm) return
    stopApprovalWatch?.()
    stopApprovalWatch = undefined
    approvalForm = next
    stopApprovalWatch = next?.subscribe(notifyApproval)
    notifyApproval()
  }
  bindApprovalSeat(settingsSeat())
  // A settings shell may activate after this bundle. Wait for it lazily instead of making
  // configForms a required inject (which would leave the whole workbench half pending in a
  // deployment that does not compose settings).
  ;(ctx as unknown as { inject?: (deps: readonly string[], callback: (scoped: unknown) => unknown) => unknown }).inject?.(['configForms'], (scoped) => {
    bindApprovalSeat((scoped as { configForms?: ConfigFormsSeat }).configForms)
    return () => { stopApprovalWatch?.(); stopApprovalWatch = undefined; approvalForm = undefined }
  })
  const confirmMode = (): 'auto' | 'ask' => confirmModeFrom(approvalForm?.getSnapshot().value)
  const subscribeConfirmMode = (listener: () => void): (() => void) => {
    approvalListeners.add(listener)
    return () => { approvalListeners.delete(listener) }
  }

  const hasView = (view: 'merge' | 'health'): boolean => {
    try {
      const entries = (ctx as unknown as { slots?: { entries?: (name: string) => Array<{ options?: { id?: string } }> } }).slots?.entries?.('evolution.workbench.view') ?? []
      return entries.some(entry => entry.options?.id === (view === 'merge' ? 'merge' : 'skill-health'))
    } catch { return false }
  }
  const subscribeViews = (listener: () => void): (() => void) => {
    try {
      const slots = (ctx as unknown as { slots?: { subscribe?: (name: string, fn: () => void) => () => void } }).slots
      return slots?.subscribe?.('evolution.workbench.view', listener) ?? (() => {})
    } catch { return () => {} }
  }
  const pendingT = bindLocale(ctx, SETTINGS_NS, settingsDictionaries, 'en', false).t
  const historyFace = (t: Translate): PanelFace => ({
    t,
    format: (key, values) => t(key, values),
    loadSkills: api.skills,
    loadVersions: api.versions,
    loadStats: api.stats,
    loadDiff: api.diff,
    loadBody: api.body,
    undo: api.undo,
    markdownWords: { copy: t('markdown.copy'), copied: t('markdown.copied'), footnotes: t('markdown.footnotes') },
  })
  const approvalApi = createApprovalApi((input, init) => fetch(input, init))
  const pendingFace = (): PendingCardFace => ({ t: pendingT, api: approvalApi, confirmMode, subscribeConfirmMode, fallback: FALLBACKS.approval })

  const loadTaskCounts = async (): Promise<WorkbenchTaskCounts> => {
    const pending = approvalApi.pending().then(answer => answer.ok ? answer.data.length : 0).catch(() => 0)
    const merge = fetchMergePendingCount()
    const [pendingCount, mergeCount] = await Promise.all([pending, merge])
    return { pending: pendingCount, merge: mergeCount }
  }
  const workbenchStore = createWorkbenchStore()
  registerSurface<WorkbenchFace>(ctx, {
    surface: 'sidebar',
    id: WORKBENCH_ID,
    order: PANEL_ORDER,
    namespace: NS,
    dictionaries,
    styles: { css: CSS + WORKBENCH_CSS + PAGE_SURFACE_CSS, tagId: CSS_TAG_ID },
    icon: WorkbenchIcon,
    component: WorkbenchPage as unknown as (props: never) => ReactNode,
    body: (t): WorkbenchFace => ({
      t,
      store: workbenchStore,
      history: historyFace(t),
      pending: pendingFace(),
      stats: { t, loadStats: api.stats },
      hasView,
      subscribeViews,
      loadTaskCounts,
    }),
    children: { 'evolution.workbench.view': { kind: 'list', scope: 'root' } },
  })
}
