/**
 * Browser half: the family workbench page, starting with the history view.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSkillHistoryApi } from './api.ts'
import { createApprovalApi } from '../../settings/api.ts'
import { createSettingsSeat, registerSidebarPanel, PAGE_SURFACE_CSS, type Translate } from '@lmzhen/dsh-evolution-client-kit'
import { confirmModeFrom, type PendingCardFace } from '../../settings/PendingCard.ts'
import type { DiagnosticsCardFace } from '../../settings/DiagnosticsCard.ts'
import { createDiagnosticsApi } from '../../settings/diagnostics-state.ts'
import { fill as settingsFill, message as settingsMessage, NS as SETTINGS_NS } from '../../settings/messages.ts'
import { FALLBACKS } from '@lmzhen/dsh-evolution-client-kit/generated/fallbacks'
import { en, NS, zh } from './messages.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'
import type { PanelFace } from './Panel.ts'
import { PANEL_ORDER } from './ids.ts'
export { PANEL_ORDER }
import { WorkbenchIcon, WorkbenchPage, WORKBENCH_CSS, WORKBENCH_ID, type WorkbenchFace } from './Workbench.ts'
import { createWorkbenchStore } from './WorkbenchStore.ts'

/** Required client services: the slot registry and the locale seat. */
export const inject = ['slots', 'locale']

/**
 * Register the locale namespace, the workbench main occupant and its sidebar row.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const api = createSkillHistoryApi()
  const settingsSeat = createSettingsSeat(ctx as unknown as { get?: (name: string) => unknown })
  ctx.effect(() => () => { settingsSeat.dispose?.() }, 'evolution-ui: settings seat')
  // U-6: unknown must never mean "auto-execute". The form starts at `ask`; the family
  // describe answers with the user layer and flips to auto only when the operator chose it.
  let approvalConfirmMode: 'auto' | 'ask' = 'ask'
  const approvalForm = settingsSeat.get('evolution-approval')
  const stopApprovalWatch = approvalForm?.subscribe(() => {
    approvalConfirmMode = confirmModeFrom(approvalForm.getSnapshot().user)
  })
  if (stopApprovalWatch !== undefined) ctx.effect(() => stopApprovalWatch, 'evolution-history: approval confirm mode')
  const confirmMode = (): 'auto' | 'ask' => approvalConfirmMode

  const hasView = (view: 'merge' | 'health'): boolean => {
    try {
      const entries = (ctx as unknown as { slots?: { entries?: (name: string) => Array<{ options?: { id?: string } }> } }).slots?.entries?.('evolution.workbench.view') ?? []
      return entries.some(entry => entry.options?.id === (view === 'merge' ? 'merge' : 'skill-health'))
    } catch { return false }
  }
  const pendingT = (key: string, values?: Readonly<Record<string, string | number>>): string => {
    let template: string
    try { template = (ctx as unknown as { locale: { bind(ns: string): (key: string) => string } }).locale.bind(SETTINGS_NS)(key) } catch { template = settingsMessage(key as never) }
    return values === undefined ? template : settingsFill(template, values)
  }
  const historyFace = (t: Translate): PanelFace => ({
    t,
    format: (key, values) => t(key, values),
    loadSkills: api.skills,
    loadVersions: api.versions,
    loadDiff: api.diff,
    loadBody: api.body,
    undo: api.undo,
    markdownWords: { copy: t('markdown.copy'), copied: t('markdown.copied'), footnotes: t('markdown.footnotes') },
  })
  const pendingFace = (): PendingCardFace => ({ t: pendingT, api: createApprovalApi((input, init) => fetch(input, init)), confirmMode, fallback: FALLBACKS.approval })
  const diagnosticsFace = (): DiagnosticsCardFace => ({ t: pendingT, api: createDiagnosticsApi((input, init) => fetch(input, init)), fallback: FALLBACKS.diagnostics })

  const workbenchStore = createWorkbenchStore()
  registerSidebarPanel<WorkbenchFace>(ctx, {
    id: WORKBENCH_ID,
    order: PANEL_ORDER,
    namespace: NS,
    dictionaries: { zh, en },
    styles: { css: CSS + WORKBENCH_CSS + PAGE_SURFACE_CSS, tagId: CSS_TAG_ID },
    icon: WorkbenchIcon,
    component: WorkbenchPage as unknown as (props: never) => unknown,
    body: (t): WorkbenchFace => ({ t, store: workbenchStore, history: historyFace(t), pending: pendingFace(), diagnostics: diagnosticsFace(), hasView }),
    children: { 'evolution.workbench.view': { kind: 'list', scope: 'root' } },
  })
}
