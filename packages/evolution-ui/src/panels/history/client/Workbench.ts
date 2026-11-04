/**
 * The family's one task page. G3 owns the history view; later groups add health
 * without creating another page or a second navigation registry.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import { createElement, useState, type ReactNode } from 'react'
import { PAGE_SURFACE_CLASS } from '@lmzhen/dsh-evolution-client-kit'
import { tokenVars } from '@lmzhen/dsh-evolution-client-kit/tokens'
import { SkillHistoryPanel, type PanelFace } from './Panel.ts'
import { PendingCard, type PendingCardFace } from '../../settings/PendingCard.ts'

/** Stable page id used by the sidebar row, the page slot key, and navigation params. */
export const WORKBENCH_ID = 'evolution.workbench'

/** Injected face: copy plus the history view's data callbacks. */
export interface WorkbenchFace {
  readonly t: (key: string) => string
  readonly history: PanelFace
  readonly pending: PendingCardFace
  /** Whether a feature view is actually mounted (health is disabled by default). */
  readonly hasView?: (view: 'merge' | 'health') => boolean
}

/** The two views the workbench owns today. */
export type WorkbenchView = 'history' | 'pending' | 'merge' | 'health'

/** Sidebar row injected face. */
export interface WorkbenchNavFace {
  readonly t: (key: string) => string
}

/**
 * Render the workbench page. The platform keeps it mounted; this component only
 * consumes a new explicit revision exactly once.
 * @param props - page owner props plus the injected history face.
 * @returns the page surface.
 */
export function WorkbenchPage(props: WorkbenchFace & { readonly renderSlot?: (name: string, owner: Record<string, unknown>) => ReactNode }): ReactNode {
  const [selectedSkill, setSelectedSkill] = useState<string | undefined>(undefined)
  const [view, setView] = useState<WorkbenchView>('history')
  const [focusRevision, setFocusRevision] = useState(0)
  const openHistory = (skill: string | undefined): void => {
    setSelectedSkill(skill)
    setView('history')
    setFocusRevision(value => value + 1)
  }
  const viewOrder: readonly WorkbenchView[] = ['history', 'pending', 'merge', 'health']
  const onTabKey = (event: { key: string; preventDefault: () => void }, current: WorkbenchView): void => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0 && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const index = viewOrder.indexOf(current)
    const next = event.key === 'Home' ? viewOrder[0]! : event.key === 'End' ? viewOrder[viewOrder.length - 1]! : viewOrder[(index + delta + viewOrder.length) % viewOrder.length]!
    setView(next)
    requestAnimationFrame(() => { document.getElementById('evo-workbench-tab-' + next)?.focus() })
  }
  const hasMerge = props.hasView?.('merge') ?? true
  const hasHealth = props.hasView?.('health') ?? true
  return createElement('section', { className: PAGE_SURFACE_CLASS + ' evo-workbench', 'data-page': view },
    createElement('div', { className: 'evo-workbench-head' },
      createElement('h1', { className: 'evo-workbench-title' }, props.t('entry.label')),
      createElement('div', { className: 'evo-workbench-tabs', role: 'tablist', 'aria-label': props.t('entry.label') },
        createElement('button', { id: 'evo-workbench-tab-history', type: 'button', role: 'tab', tabIndex: view === 'history' ? 0 : -1, 'aria-selected': view === 'history' ? 'true' : 'false', 'aria-controls': 'evo-workbench-panel', 'data-active': view === 'history' ? 'true' : undefined, onClick: () => { setView('history') }, onKeyDown: (event: { key: string; preventDefault: () => void }) => { onTabKey(event, 'history') } }, props.t('workbench.history')),
        createElement('button', { id: 'evo-workbench-tab-pending', type: 'button', role: 'tab', tabIndex: view === 'pending' ? 0 : -1, 'aria-selected': view === 'pending' ? 'true' : 'false', 'aria-controls': 'evo-workbench-panel', 'data-active': view === 'pending' ? 'true' : undefined, onClick: () => { setView('pending') }, onKeyDown: (event: { key: string; preventDefault: () => void }) => { onTabKey(event, 'pending') } }, props.t('workbench.pending')),
        !hasMerge ? null : createElement('button', { id: 'evo-workbench-tab-merge', type: 'button', role: 'tab', tabIndex: view === 'merge' ? 0 : -1, 'aria-selected': view === 'merge' ? 'true' : 'false', 'aria-controls': 'evo-workbench-panel', 'data-active': view === 'merge' ? 'true' : undefined, onClick: () => { setView('merge') }, onKeyDown: (event: { key: string; preventDefault: () => void }) => { onTabKey(event, 'merge') } }, props.t('workbench.merge')),
        !hasHealth ? null : createElement('button', { id: 'evo-workbench-tab-health', type: 'button', role: 'tab', tabIndex: view === 'health' ? 0 : -1, 'aria-selected': view === 'health' ? 'true' : 'false', 'aria-controls': 'evo-workbench-panel', 'data-active': view === 'health' ? 'true' : undefined, onClick: () => { setView('health') }, onKeyDown: (event: { key: string; preventDefault: () => void }) => { onTabKey(event, 'health') } }, props.t('workbench.health')),
      ),
    ),
    createElement('div', { className: 'evo-workbench-body', id: 'evo-workbench-panel', role: 'tabpanel' },
      view === 'history'
        ? createElement(SkillHistoryPanel, { ...props.history, focusSkill: selectedSkill, focusRevision })
        : view === 'pending'
          ? createElement(PendingCard, props.pending)
          : null,
      // The feature list stays mounted while another view is active; each view hides itself.
      createElement('div', { hidden: view !== 'merge' && view !== 'health', className: 'evo-workbench-feature' },
        props.renderSlot?.('evolution.workbench.view', { activeView: view, openHistory }) ?? null),
    ),
  )
}

/** The sidebar icon; the platform renders the row label, tooltip and active state. */
export function WorkbenchIcon(props: { size?: number; active?: boolean }): ReactNode {
  const size = props.size ?? 16
  return createElement('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
    createElement('path', { d: 'M2 3.5h12M2 8h12M2 12.5h8', fill: 'none', stroke: 'currentColor', 'stroke-width': props.active === true ? 1.7 : 1.4, 'stroke-linecap': 'round' }),
  )
}

/** Workbench shell and sidebar row; colours come from the platform tokens. */
export const WORKBENCH_CSS = [
  tokenVars('.evo-workbench'),
  '.evo-workbench{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0}',
  '.evo-workbench-head{display:flex;align-items:center;justify-content:space-between;gap:var(--evo-space-16);padding:var(--evo-space-12) var(--evo-space-16);border-bottom:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}',
  '.evo-workbench-tabs{display:flex;gap:var(--evo-space-4)}',
  '.evo-workbench-tabs button{padding:var(--evo-space-4) var(--evo-space-8);border:0;border-radius:var(--evo-radius-control);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--evo-type-sm);cursor:pointer}',
  '.evo-workbench-tabs button[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  '.evo-workbench-tabs button:focus-visible{outline:var(--evo-focus-ring);outline-offset:var(--evo-focus-offset)}',
  '.evo-workbench-title{margin:0;font-size:var(--evo-type-lg);font-weight:600;line-height:var(--evo-leading-base)}',
  '.evo-workbench-body{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}',
  '.evo-workbench-nav{display:flex;width:100%;align-items:center;gap:var(--evo-space-8);padding:var(--evo-space-6) var(--evo-space-12);border:0;border-radius:var(--evo-radius-control);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--evo-type-sm);text-align:left;cursor:pointer}',
  '.evo-workbench-nav:hover,.evo-workbench-nav[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  '.evo-workbench-nav:focus-visible{outline:var(--evo-focus-ring);outline-offset:var(--evo-focus-offset)}',
  '@media (max-width:720px){.evo-workbench-head{flex-wrap:wrap}.evo-workbench-tabs{flex-wrap:wrap}}',
].join('')
