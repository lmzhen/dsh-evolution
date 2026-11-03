/**
 * The family's one task page. G3 owns the history view; later groups add health
 * without creating another page or a second navigation registry.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { PAGE_SURFACE_CLASS } from '@lmzhen/dsh-evolution-client-kit'
import { tokenVars } from '@lmzhen/dsh-evolution-client-kit/tokens'
import { SkillHistoryPanel, type PanelFace } from './Panel.ts'
import { PendingCard, type PendingCardFace } from '../../settings/PendingCard.ts'

/** Stable page id used by the sidebar row, the page slot key, and navigation params. */
export const WORKBENCH_ID = 'evolution.workbench'

/** Owner props supplied by the platform page slot. */
export interface WorkbenchOwner {
  readonly pageId: string
  readonly params?: Readonly<Record<string, string | number | boolean | null>> | undefined
  readonly revision?: number | undefined
}

/** Injected face: copy plus the history view's data callbacks. */
export interface WorkbenchFace {
  readonly t: (key: string) => string
  readonly history: PanelFace
  readonly pending: PendingCardFace
}

/** The two views the workbench owns today. */
export type WorkbenchView = 'history' | 'pending' | 'merge' | 'health'

/** Sidebar row owner props supplied by the platform list slot. */
export interface WorkbenchNavOwner {
  readonly activePageId: string | null
  readonly openPage: (pageId: string) => void
}

/** Sidebar row injected face. */
export interface WorkbenchNavFace {
  readonly t: (key: string) => string
}

/** Convert a navigation params value to a skill name only when it is a non-empty string. */
function skillOf(params: WorkbenchOwner['params']): string | undefined {
  const value = params?.['skillName']
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Render the workbench page. The platform keeps it mounted; this component only
 * consumes a new explicit revision exactly once.
 * @param props - page owner props plus the injected history face.
 * @returns the page surface.
 */
export function WorkbenchPage(props: WorkbenchOwner & WorkbenchFace & { readonly renderSlot: (name: string, owner: Record<string, unknown>) => ReactNode }): ReactNode {
  const [selectedSkill, setSelectedSkill] = useState<string | undefined>(undefined)
  const [view, setView] = useState<WorkbenchView>('history')
  const lastRevision = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (props.revision === undefined || props.revision === lastRevision.current) return
    lastRevision.current = props.revision
    const requested = props.params?.['view']
    if (requested === 'pending' || requested === 'merge' || requested === 'health') { setView(requested); return }
    setView('history')
    const skill = skillOf(props.params)
    if (skill !== undefined) setSelectedSkill(skill)
  }, [props.params, props.revision])
  const focusRevision = props.revision === lastRevision.current ? props.revision : undefined
  return createElement('section', { className: PAGE_SURFACE_CLASS + ' evo-workbench', 'data-page': view },
    createElement('div', { className: 'evo-workbench-head' },
      createElement('h1', { className: 'evo-workbench-title' }, props.t('entry.label')),
      createElement('div', { className: 'evo-workbench-tabs', role: 'tablist', 'aria-label': props.t('entry.label') },
        createElement('button', { type: 'button', role: 'tab', 'aria-selected': view === 'history' ? 'true' : 'false', 'data-active': view === 'history' ? 'true' : undefined, onClick: () => { setView('history') } }, props.t('workbench.history')),
        createElement('button', { type: 'button', role: 'tab', 'aria-selected': view === 'pending' ? 'true' : 'false', 'data-active': view === 'pending' ? 'true' : undefined, onClick: () => { setView('pending') } }, props.t('workbench.pending')),
        createElement('button', { type: 'button', role: 'tab', 'aria-selected': view === 'merge' ? 'true' : 'false', 'data-active': view === 'merge' ? 'true' : undefined, onClick: () => { setView('merge') } }, props.t('workbench.merge')),
        createElement('button', { type: 'button', role: 'tab', 'aria-selected': view === 'health' ? 'true' : 'false', 'data-active': view === 'health' ? 'true' : undefined, onClick: () => { setView('health') } }, props.t('workbench.health')),
      ),
    ),
    createElement('div', { className: 'evo-workbench-body' },
      view === 'history'
        ? createElement(SkillHistoryPanel, { ...props.history, focusSkill: selectedSkill, focusRevision })
        : view === 'pending'
          ? createElement(PendingCard, props.pending)
          : null,
      // The feature list stays mounted while another view is active; each view hides itself.
      createElement('div', { hidden: view !== 'merge' && view !== 'health', className: 'evo-workbench-feature' },
        props.renderSlot('evolution.workbench.view', { activeView: view })),
    ),
  )
}

/**
 * Render the sidebar entry that opens the workbench.
 * @param props - active page id, opener, and copy.
 * @returns the row button.
 */
export function WorkbenchNav(props: WorkbenchNavOwner & WorkbenchNavFace): ReactNode {
  const active = props.activePageId === WORKBENCH_ID
  return createElement('button', {
    type: 'button',
    className: 'evo-workbench-nav',
    'data-active': active ? 'true' : undefined,
    'aria-current': active ? 'page' : undefined,
    onClick: () => { props.openPage(WORKBENCH_ID) },
  }, props.t('entry.label'))
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
].join('')
