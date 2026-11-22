/**
 * The family's one task page. G3 owns the history view; later groups add health
 * without creating another page or a second navigation registry.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { PAGE_SURFACE_CLASS } from '@lmzhen/dsh-evolution-client-kit'
import { tokenVars } from '@lmzhen/dsh-evolution-client-kit/tokens'
import type { SkillStatsSnapshot } from '@deepseek-ai/dsh-evolution-core/skills'
import { SkillHistoryPanel, type PanelFace } from './Panel.ts'
import { PendingCard, type PendingCardFace } from '../../settings/PendingCard.ts'
import { StatsPage, STATS_CSS, type StatsFace } from './StatsPage.ts'
import { resolveDefaultView, type WorkbenchDataState, type WorkbenchStore, type WorkbenchTaskCounts, type WorkbenchView } from './WorkbenchStore.ts'

/** Stable page id used by the sidebar row, the page slot key, and navigation params. */
export const WORKBENCH_ID = 'evolution.workbench'

/** Injected face: copy plus the history view's data callbacks. */
export interface WorkbenchFace {
  readonly t: (key: string) => string
  readonly store: WorkbenchStore
  readonly history: PanelFace
  readonly pending: PendingCardFace
  /** The data overview view; absent in older test hosts that do not mount the stats page. */
  readonly stats?: Omit<StatsFace, 'view' | 'onView' | 'layout' | 'openSkill' | 'onOrganize'>
  /** Whether a feature view is actually mounted (merge is optional). */
  readonly hasView?: (view: 'merge') => boolean
  /** Subscribe to the view ledger so a late merge half still supplies its tab. */
  readonly subscribeViews?: (listener: () => void) => () => void
  /** Read-only task counts for the first landing; absent keeps history. */
  readonly loadTaskCounts?: (() => Promise<WorkbenchTaskCounts>) | undefined
}

export type { WorkbenchView } from './WorkbenchStore.ts'

/**
 * Share one stats read across the history view (health chips/governance/counts) and the data table.
 * The promise is cached for the workbench lifetime; a failed read clears the cache so a retry is
 * possible, and an absent loader stays absent (old hosts keep the legacy health route).
 * @param loader - the stats read, when the host provides one.
 * @returns the shared loader, or undefined when the host has no stats read.
 */
function useSharedStats(loader: (() => Promise<SkillStatsSnapshot>) | undefined): { load: () => Promise<SkillStatsSnapshot>; invalidate: () => void } | undefined {
  const cache = useRef<{ readonly promise: Promise<SkillStatsSnapshot> } | null>(null)
  const load = useMemo<() => Promise<SkillStatsSnapshot>>(() => () => {
    if (loader === undefined) return Promise.reject(new Error('stats loader missing'))
    const current = cache.current
    if (current !== null) return current.promise
    const promise = loader()
    cache.current = { promise }
    promise.catch(() => { if (cache.current?.promise === promise) cache.current = null })
    return promise
  }, [loader])
  const invalidate = useMemo(() => () => { cache.current = null }, [])
  return useMemo(() => loader === undefined ? undefined : { load, invalidate }, [loader, load, invalidate])
}



/**
 * Observe the workbench body, not the window: the platform can place this page in a narrow main
 * panel while the viewport is wide. 960px is the split-pane boundary; below it the history view is a
 * one-pane list/detail route.
 * @param ref - the body element.
 * @returns the current width bucket.
 */
function useWorkbenchLayout(ref: { readonly current: HTMLElement | null }): 'wide' | 'medium' | 'narrow' {
  const [layout, setLayout] = useState<'wide' | 'medium' | 'narrow'>('wide')
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = (): void => {
      const width = element.getBoundingClientRect().width
      if (width <= 0) return
      setLayout(width >= 960 ? 'wide' : width >= 640 ? 'medium' : 'narrow')
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [ref])
  return layout
}



/**
 * Render the workbench page. The platform keeps it mounted, so this component only consumes
 * store changes and dispatches explicit navigation commands.
 * @param props - page owner props plus the injected history face.
 * @returns the page surface.
 */
export function WorkbenchPage(props: WorkbenchFace & { readonly renderSlot?: (name: string, owner: Record<string, unknown>) => ReactNode }): ReactNode {
  const state = useSyncExternalStore(props.store.subscribe, props.store.getState, props.store.getState)
  const view = state.view
  const selectedSkill = state.selectedSkill
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const layout = useWorkbenchLayout(bodyRef)
  const pendingListFocus = useRef<string | undefined>(undefined)
  const pendingDataFocus = useRef(false)
  const openHistory = (skill: string | undefined, origin?: 'data' | 'list'): void => {
    props.store.openHistory(skill, skill === undefined ? undefined : origin ?? 'list')
  }
  const backFromDetail = (): void => {
    pendingListFocus.current = state.origin === 'list' ? selectedSkill : undefined
    pendingDataFocus.current = state.origin === 'data'
    if (state.origin === 'data') props.store.backToData()
    else props.store.backToList()
  }
  const hasMerge = useSyncExternalStore(
    props.subscribeViews ?? (() => () => {}),
    () => props.hasView?.('merge') ?? true,
    () => props.hasView?.('merge') ?? true,
  )
  const hasData = props.stats !== undefined
  const sharedStats = useSharedStats(props.stats?.loadStats)
  const [statsEpoch, setStatsEpoch] = useState(0)
  const loadStats = useMemo(
    () => sharedStats?.load ?? props.stats?.loadStats,
    [sharedStats, props.stats?.loadStats, statsEpoch],
  )
  const invalidateStats = (): void => {
    if (sharedStats === undefined) return
    sharedStats.invalidate()
    setStatsEpoch(version => version + 1)
  }
  const history = sharedStats === undefined
    ? props.history
    : { ...props.history, loadStats, invalidateStats }
  const controlledHistory = {
    ...history,
    selected: selectedSkill,
    selectionRevision: state.selectionRevision,
    onSelect: (name: string): void => { props.store.openHistory(name, 'list') },
    query: state.historyQuery,
    onQuery: (value: string): void => { props.store.setHistoryQuery(value) },
  }
  // Mount the data view on first visit and keep it mounted afterwards: its search/sort/scroll survive a
  // trip into a skill, while a host that never opens "Data overview" pays no stats read.
  const [dataMounted, setDataMounted] = useState(view === 'data')
  useEffect(() => {
    if (view === 'data' && !dataMounted) setDataMounted(true)
  }, [view, dataMounted])
  useEffect(() => {
    if (view === 'merge' && !hasMerge) props.store.setDefaultView('history')
    if (view === 'data' && !hasData) props.store.setDefaultView('history')
  }, [view, hasMerge, hasData, props.store])
  useEffect(() => {
    const load = props.loadTaskCounts
    if (load === undefined || state.explicitView === true) return
    let live = true
    void load().then(counts => {
      if (live) props.store.setDefaultView(resolveDefaultView(counts, hasMerge))
    }).catch(() => { /* no counts means keep the stable history landing */ })
    return () => { live = false }
  }, [props.loadTaskCounts, state.explicitView, hasMerge, props.store])
  useEffect(() => {
    if (layout !== 'narrow' || state.origin !== 'list' || selectedSkill === undefined) return
    document.querySelector<HTMLElement>('.evo-hist-title')?.focus()
  }, [layout, state.origin, selectedSkill])
  useEffect(() => {
    const name = pendingListFocus.current
    if (name === undefined || selectedSkill !== undefined) return
    pendingListFocus.current = undefined
    const item = Array.from(document.querySelectorAll<HTMLElement>('.evo-hist-skill'))
      .find(candidate => candidate.dataset.skill === name)
    if (item !== undefined) item.focus()
    else document.querySelector<HTMLInputElement>('.evo-hist-search input')?.focus()
  }, [selectedSkill])
  useEffect(() => {
    if (view !== 'data' || !pendingDataFocus.current) return
    pendingDataFocus.current = false
    document.querySelector<HTMLElement>('.evo-stats-title')?.focus()
  }, [view])
  // Keyboard order contains only tabs that actually rendered; a hidden view has no button to land on.
  const viewOrder: readonly WorkbenchView[] = (['history', 'data', 'pending', 'merge'] as const)
    .filter(value => (value !== 'merge' || hasMerge) && (value !== 'data' || hasData))
  const onTabKey = (event: { key: string; preventDefault: () => void }, current: WorkbenchView): void => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0 && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const index = viewOrder.indexOf(current)
    const next = event.key === 'Home' ? viewOrder[0]! : event.key === 'End' ? viewOrder[viewOrder.length - 1]! : viewOrder[(index + delta + viewOrder.length) % viewOrder.length]!
    props.store.setView(next)
    requestAnimationFrame(() => { document.getElementById('evo-workbench-tab-' + next)?.focus() })
  }
  return createElement('section', { className: PAGE_SURFACE_CLASS + ' evo-workbench', 'data-page': view },
    createElement('div', { className: 'evo-workbench-head' },
      createElement('h1', { className: 'evo-workbench-title', 'data-view': view }, props.t('workbench.title')),
      createElement('div', { className: 'evo-workbench-tabs', role: 'tablist', 'aria-label': props.t('entry.label') },
        createElement('button', { id: 'evo-workbench-tab-history', type: 'button', role: 'tab', tabIndex: view === 'history' ? 0 : -1, 'aria-selected': view === 'history' ? 'true' : 'false', 'aria-controls': 'evo-workbench-panel', 'data-active': view === 'history' ? 'true' : undefined, onClick: () => { props.store.setView('history') }, onKeyDown: (event: { key: string; preventDefault: () => void }) => { onTabKey(event, 'history') } }, props.t('workbench.history')),
        !hasData ? null : createElement('button', { id: 'evo-workbench-tab-data', type: 'button', role: 'tab', tabIndex: view === 'data' ? 0 : -1, 'aria-selected': view === 'data' ? 'true' : 'false', 'aria-controls': 'evo-workbench-panel', 'data-active': view === 'data' ? 'true' : undefined, onClick: () => { props.store.setView('data') }, onKeyDown: (event: { key: string; preventDefault: () => void }) => { onTabKey(event, 'data') } }, props.t('workbench.data')),
        createElement('button', { id: 'evo-workbench-tab-pending', type: 'button', role: 'tab', tabIndex: view === 'pending' ? 0 : -1, 'aria-selected': view === 'pending' ? 'true' : 'false', 'aria-controls': 'evo-workbench-panel', 'data-active': view === 'pending' ? 'true' : undefined, onClick: () => { props.store.setView('pending') }, onKeyDown: (event: { key: string; preventDefault: () => void }) => { onTabKey(event, 'pending') } }, props.t('workbench.pending')),
        !hasMerge ? null : createElement('button', { id: 'evo-workbench-tab-merge', type: 'button', role: 'tab', tabIndex: view === 'merge' ? 0 : -1, 'aria-selected': view === 'merge' ? 'true' : 'false', 'aria-controls': 'evo-workbench-panel', 'data-active': view === 'merge' ? 'true' : undefined, onClick: () => { props.store.setView('merge') }, onKeyDown: (event: { key: string; preventDefault: () => void }) => { onTabKey(event, 'merge') } }, props.t('workbench.merge')),
      ),
    ),
    createElement('div', { className: 'evo-workbench-body', id: 'evo-workbench-panel', role: 'tabpanel', 'aria-labelledby': 'evo-workbench-tab-' + view, tabIndex: 0, ref: bodyRef },
      view === 'history'
        ? createElement('div', { className: 'evo-workbench-history-stack' },
          state.origin !== undefined && (layout !== 'wide' || state.origin === 'data')
            ? createElement('div', { className: 'evo-workbench-backbar' },
              createElement('button', {
                type: 'button',
                className: 'evo-workbench-back',
                onClick: backFromDetail,
              }, '← ' + props.t(state.origin === 'data' ? 'workbench.backToData' : 'workbench.backToList')))
            : null,
          createElement(SkillHistoryPanel, controlledHistory))
        : view === 'pending'
          ? createElement(PendingCard, { ...props.pending, onHistory: () => { openHistory(undefined) } })
          : null,
      hasData && dataMounted
        ? createElement('div', { hidden: view !== 'data', className: 'evo-workbench-feature evo-workbench-data' },
          createElement(StatsPage, {
            ...props.stats!,
            loadStats: loadStats ?? props.stats!.loadStats,
            statsRevision: statsEpoch,
            view: state.data,
            onView: (patch: Partial<WorkbenchDataState>) => { props.store.setDataView(patch) },
            layout,
            openSkill: (name: string) => { openHistory(name, 'data') },
            onOrganize: () => { openHistory(undefined) },
          }))
        : null,
      // The feature list stays mounted while another view is active; each view hides itself.
      createElement('div', { hidden: view !== 'merge', className: 'evo-workbench-feature' },
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
  STATS_CSS,
  // Skins make the base/layer tokens translucent. The platform's overlay token stays readable over
  // a photograph; use it for the family content surface without changing the shell.
  // Skin tokens are alpha. Repeat the same base token into the page layer (never overlay) so the
  // surface stays readable without introducing a literal colour; higher specificity beats the
  // platform's later .evolution-page-surface rule.
  '.evolution-page-surface.evo-workbench{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(var(--dsw-alias-bg-base),var(--dsw-alias-bg-base)),linear-gradient(var(--dsw-alias-bg-base),var(--dsw-alias-bg-base)),linear-gradient(var(--dsw-alias-bg-base),var(--dsw-alias-bg-base)),linear-gradient(var(--dsw-alias-bg-base),var(--dsw-alias-bg-base)),linear-gradient(var(--dsw-alias-bg-base),var(--dsw-alias-bg-base))}',
  '.evo-workbench-head{display:flex;align-items:center;justify-content:space-between;gap:var(--evo-space-16);padding:var(--evo-space-12) var(--evo-space-16);border-bottom:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}',
  '.evo-workbench-tabs{display:flex;gap:var(--evo-space-4)}',
  '.evo-workbench-tabs button{padding:var(--evo-space-4) var(--evo-space-8);border:0;border-radius:var(--evo-radius-control);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--evo-type-sm);cursor:pointer}',
  '.evo-workbench-tabs button[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  '.evo-workbench-tabs button:focus-visible{outline:var(--evo-focus-ring);outline-offset:var(--evo-focus-offset)}',
  '.evo-workbench-title{margin:0;font-size:var(--evo-type-lg);font-weight:600;line-height:var(--evo-leading-base)}',
  '.evo-workbench-body{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden;container-type:inline-size}',
  '.evo-workbench-history-stack{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column}',
  '.evo-workbench-history-stack>.evo-hist-frame{flex:1;min-height:0}',
  '.evo-workbench-backbar{flex:0 0 auto;display:flex;align-items:center;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
  '.evo-workbench-back{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
  '.evo-workbench-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  '.evo-workbench-back:focus-visible{outline:var(--evo-focus-ring);outline-offset:var(--evo-focus-offset)}',
  '.evo-workbench-data{flex:1;min-width:0;min-height:0}',
  '.evo-workbench-feature{display:flex;flex:1;min-width:0;min-height:0}',
  '.evo-workbench-feature[hidden]{display:none}',
  '.evo-workbench-feature>*{flex:1;min-width:0}',
  '.evo-workbench-feature .evolution-merge-panel,.evo-workbench-feature .evolution-skill-health-panel{flex:1 1 auto;min-width:0}',
  '.evo-workbench-body>.evolution-param-card{flex:1;min-width:0;overflow:auto}',
  '@media (max-width:720px){.evo-workbench-head{flex-wrap:wrap}.evo-workbench-tabs{flex-wrap:wrap}}',
].join('')
