/** Batch 4 merge panel: keyed read store, four tabs, local overlays, localized errors. */
import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { CSS_TAG_ID } from './styles.ts'
import { platformModal } from './platform-modal.ts'
import { PLATFORM_MENU, renderPlatformMenu } from '@lmzhen/dsh-evolution-client-kit'
import { isBlocked, type MergeFailure, type MergeProblem, type MergeQueue } from './api.ts'
import type { MergeStore, OverlayState, QueueState, StoreSnapshot } from './MergeStore.ts'
import { formatLocalDateTime, TaskBanner, type SettingsFace } from '@lmzhen/dsh-evolution-client-kit'
import { createRowOrderStore, moveRow, orderRows, pinRow, resolveWorkspaceId, rowOrderKey, type RowOrderEdge } from './sorting.ts'
import { MergeRunStrips } from './MergeRunStrip.ts'
import { MergeRow, type RowSortHandlers } from './MergeRow.ts'
import { MergeSettings } from './MergeSettings.ts'
import { FALLBACK_COMMANDS } from './fallbacks.ts'

export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string
export interface MergeFace { store: MergeStore; t: Translate; doctorCommand?: string; settings?: SettingsFace; workspaceId?: string; decide?: (rowId: string, verb: 'approve' | 'reject') => Promise<{ ok: boolean; message: string }> }
const QUEUES: MergeQueue[] = ['verify', 'pending', 'fuse', 'skipped']
const DOCTOR_COMMAND = '/evolution doctor'

function problemKey(problem: MergeProblem): string {
  switch (problem.code) {
    case 'unauthenticated': return 'failureUnauthorized'
    case 'forbidden': return 'failureForbidden'
    case 'unmounted': return 'failureUnmounted'
    case 'capability': return 'failureCapability'
    case 'body-ambiguous': return 'failureBodyAmbiguous'
    case 'wire-version': return 'failureWireVersion'
    case 'body-missing': return 'failureBodyMissing'
    case 'bad-query': return 'failureBadQuery'
    case 'refused': return 'failureRefused'
    case 'server': return 'failureServer'
  }
}
function reasonText(t: Translate, reasonCode: string | undefined, fallback: string): string {
  if (reasonCode === undefined) return fallback
  const key = 'history.reason.' + reasonCode
  const text = t(key)
  return text === key ? fallback : text
}
function blockedReasonKey(failure: Extract<MergeFailure, { kind: 'blocked' }>): string {
  const code = failure.readiness.code ?? failure.code
  if (code.endsWith('needs-repair')) return 'blocked.reason.needs-repair'
  if (code.endsWith('forward-only')) return 'blocked.reason.forward-only'
  if (code.endsWith('migration-blocked')) return 'blocked.reason.migration-blocked'
  return 'blocked.reason.unknown'
}
function failureNode(t: Translate, failure: MergeFailure, fallback: readonly string[], copy: (command: string) => void): ReactNode {
  if (isBlocked(failure)) {
    const raw = failure.readiness.message
    return createElement('div', { 'data-role': 'blocked', role: 'alert', 'data-block-code': failure.code, 'data-readiness-code': failure.readiness.code ?? '' },
      createElement('h3', { 'data-role': 'blocked-title' }, t('blocked.title')),
      createElement('p', { 'data-role': 'blocked-reason', title: raw ?? t(blockedReasonKey(failure)) }, t(blockedReasonKey(failure))),
      createElement('p', { 'data-role': 'blocked-hint' }, t('blocked.hint')),
      raw === undefined ? null : createElement('details', { 'data-role': 'blocked-detail' }, createElement('summary', null, t('blocked.detail')), createElement('p', { 'data-role': 'blocked-raw' }, raw)),
      createElement('div', { 'data-role': 'blocked-actions' },
        createElement('button', { type: 'button', 'data-role': 'doctor', onClick: () => { copy(DOCTOR_COMMAND) } }, t('blocked.doctor')),
        createElement('button', { type: 'button', 'data-role': 'refresh', onClick: () => { window.dispatchEvent(new Event('evolution-merge:refresh')) } }, t('refresh')),
      ),
    )
  }
  const capability = failure.code === 'capability'
  return createElement('div', { 'data-role': capability ? 'capability-failure' : 'failure', 'data-error-code': failure.code, 'data-status': String(failure.status) },
    createElement('p', { 'data-role': 'failure-title', title: failure.message }, t(problemKey(failure))),
    capability ? createElement('p', { 'data-role': 'capability-hint' }, t('failureCapabilityHint')) : null,
    failure.message === undefined ? null : createElement('details', { 'data-role': 'failure-detail' }, createElement('summary', null, t('failureDetails')), createElement('p', { 'data-role': 'failure-raw' }, failure.message)),
    fallback.length === 0 ? null : createElement('div', { 'data-role': 'fallback' }, fallback.map(command => createElement('button', { key: command, type: 'button', 'data-role': 'fallback-command', onClick: () => { copy(command) } }, command))),
  )
}
const overlayKey = (event: KeyboardEvent<HTMLElement>, onClose: () => void): void => {
  if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
  if (event.key !== 'Tab') return
  const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(node => !node.hasAttribute('disabled'))
  if (nodes.length === 0) return
  const first = nodes[0]!
  const last = nodes[nodes.length - 1]!
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

function bodyNode(overlay: Extract<OverlayState, { kind: 'body' }>, t: Translate, onClose: () => void): ReactNode {
  const Modal = platformModal()
  const title = t('overlay.body') + ' · ' + overlay.name
  const inner = createElement('section', {
    'data-role': 'overlay', 'data-overlay': 'body', 'aria-label': title,
    ...(Modal === undefined ? { role: 'dialog', 'aria-modal': 'true', onKeyDown: (event: KeyboardEvent<HTMLElement>) => { overlayKey(event, onClose) } } : { 'data-platform-modal': 'true' }),
  },
    createElement('div', { 'data-role': 'overlay-head' },
      createElement('h3', { 'data-role': 'overlay-title' }, title),
      createElement('button', { type: 'button', 'data-role': 'overlay-close', ...(Modal === undefined ? { autoFocus: true } : { 'data-modal-autofocus': 'true' }), onClick: onClose }, t('close')),
    ),
    createElement('p', { 'data-role': 'overlay-meta' }, t('body.' + overlay.side) + ' · ' + (overlay.status === 'ready' ? t('body.totalBytes') + ' ' + String(overlay.body?.totalBytes ?? 0) : '')),
    overlay.status === 'loading' ? createElement('p', { 'data-role': 'overlay-loading' }, t('loading')) : null,
    overlay.status === 'error' && overlay.failure !== undefined ? failureNode(t, overlay.failure, [], () => {}) : null,
    overlay.status === 'ready' && overlay.body !== undefined
      ? createElement('div', null,
          overlay.body.truncated ? createElement('p', { 'data-role': 'body-truncated' }, t('body.truncated')) : null,
          overlay.body.text === '' ? createElement('p', { 'data-role': 'body-empty' }, t('body.empty')) : createElement('pre', { 'data-role': 'body-text' }, overlay.body.text),
        )
      : null,
  )
  return Modal === undefined ? inner : createElement(Modal, { open: true, onClose, title, closeLabel: t('close'), headless: true, className: 'evo-merge-modal' }, inner)
}
function pairNode(overlay: Extract<OverlayState, { kind: 'pair' }>, t: Translate, onClose: () => void): ReactNode {
  const Modal = platformModal()
  const title = t('overlay.pair')
  const block = (target: { name: string; side: 'live' | 'archive' }, body: typeof overlay.aBody): ReactNode => createElement('section', { 'data-role': target === overlay.a ? 'body-a' : 'body-b', 'data-side': target.side },
    createElement('h4', { 'data-role': 'pair-name' }, target.name + ' · ' + t('body.' + target.side)),
    body === undefined ? null : body.truncated ? createElement('p', { 'data-role': 'body-truncated' }, t('body.truncated')) : null,
    body === undefined ? null : body.text === '' ? createElement('p', { 'data-role': 'body-empty' }, t('body.empty')) : createElement('pre', { 'data-role': 'body-text' }, body.text),
  )
  const inner = createElement('section', {
    'data-role': 'overlay', 'data-overlay': 'pair', 'aria-label': title,
    ...(Modal === undefined ? { role: 'dialog', 'aria-modal': 'true', onKeyDown: (event: KeyboardEvent<HTMLElement>) => { overlayKey(event, onClose) } } : { 'data-platform-modal': 'true' }),
  },
    createElement('div', { 'data-role': 'overlay-head' },
      createElement('h3', { 'data-role': 'overlay-title' }, title),
      createElement('button', { type: 'button', 'data-role': 'overlay-close', ...(Modal === undefined ? { autoFocus: true } : { 'data-modal-autofocus': 'true' }), onClick: onClose }, t('close')),
    ),
    overlay.status === 'loading' ? createElement('p', { 'data-role': 'overlay-loading' }, t('loading')) : null,
    overlay.status === 'error' && overlay.failure !== undefined ? failureNode(t, overlay.failure, [], () => {}) : null,
    overlay.status === 'ready' ? createElement('div', { 'data-role': 'pair-grid' }, block(overlay.a, overlay.aBody), block(overlay.b, overlay.bBody)) : null,
  )
  return Modal === undefined ? inner : createElement(Modal, { open: true, onClose, title, closeLabel: t('close'), headless: true, className: 'evo-merge-modal' }, inner)
}

function historyNode(overlay: Extract<OverlayState, { kind: 'history' }>, t: Translate, onClose: () => void): ReactNode {
  const Modal = platformModal()
  const title = t('history')
  const inner = createElement('section', {
    'data-role': 'overlay', 'data-overlay': 'history', 'aria-label': title,
    ...(Modal === undefined ? { role: 'dialog', 'aria-modal': 'true', onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } } } : { 'data-platform-modal': 'true' }),
  },
    createElement('div', { 'data-role': 'overlay-head' },
      createElement('h3', { 'data-role': 'overlay-title' }, title),
      createElement('button', { type: 'button', 'data-role': 'overlay-close', ...(Modal === undefined ? { autoFocus: true } : { 'data-modal-autofocus': 'true' }), onClick: onClose }, t('close')),
    ),
    overlay.status === 'loading' ? createElement('p', { 'data-role': 'overlay-loading' }, t('loading')) : null,
    overlay.status === 'error' && overlay.failure !== undefined ? failureNode(t, overlay.failure, [], () => {}) : null,
    overlay.status === 'ready'
      ? overlay.items === undefined || overlay.items.length === 0
        ? createElement('p', { 'data-role': 'history-empty' }, t('history.empty'))
        : createElement('ul', { 'data-role': 'history-list' }, overlay.items.map(item => createElement('li', { key: item.name + ':' + item.archivedAt, 'data-role': 'history-item' },
            item.name + ' · ' + (() => { const kind = t('history.kind.' + item.kind); const reason = reasonText(t, item.reasonCode, item.reason); return kind === reason ? kind : kind + ' · ' + reason })() + ' · v' + String(item.lastVersion) + ' · ' + (item.archivedAt === null ? t('history.archivedAtUnknown') : t('history.archivedAt', { date: formatLocalDateTime(item.archivedAt) ?? t('history.archivedAtUnknown') })),
          )))
      : null,
  )
  return Modal === undefined ? inner : createElement(Modal, { open: true, onClose, title, closeLabel: t('close'), headless: true, className: 'evo-merge-modal' }, inner)
}

export function MergePanel(face: MergeFace): ReactNode {
  const { store, t } = face
  const snapshot: StoreSnapshot = useSyncExternalStore(store.subscribe, store.read, store.read)
  const [copyState, setCopyState] = useState<{ kind: 'idle' | 'copied' | 'failed'; text?: string }>({ kind: 'idle' })
  const [orders, setOrders] = useState<Record<string, readonly string[]>>({})
  const [dragId, setDragId] = useState<string | undefined>(undefined)
  const [deciding, setDeciding] = useState<string | undefined>(undefined)
  const [decisionNotice, setDecisionNotice] = useState<{ rowId: string; ok: boolean; message: string } | undefined>(undefined)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | undefined>(undefined)
  const returnFocus = useRef<HTMLElement | null>(null)
  const captureFocus = (): void => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }
  const openBoth = (a: { name: string; side: 'live' | 'archive' }, b: { name: string; side: 'live' | 'archive' }, rowId: string | undefined): void => { captureFocus(); void store.openPair(a, b, rowId) }
  const openHistory = (): void => { captureFocus(); void store.openHistory() }
  const closeOverlay = (): void => { store.closeOverlay(); requestAnimationFrame(() => { returnFocus.current?.focus() }) }
  const workspaceId = resolveWorkspaceId(face.workspaceId)
  const orderStore = useMemo(() => createRowOrderStore(), [])
  const decideRow = (rowId: string, verb: 'approve' | 'reject'): void => {
    if (face.decide === undefined) return
    setDeciding(rowId)
    void (async () => {
      try {
        const result = await face.decide!(rowId, verb)
        setDecisionNotice({ rowId, ...result })
        store.refresh()
      } catch (error) {
        setDecisionNotice({ rowId, ok: false, message: error instanceof Error ? error.message : String(error) })
      } finally {
        setDeciding(undefined)
      }
    })()
  }
  const copy = (command: string): void => {
    void (async () => {
      try {
        if (navigator.clipboard?.writeText === undefined) throw new Error('clipboard unavailable')
        await navigator.clipboard.writeText(command)
        setCopyState({ kind: 'copied', text: command })
      } catch {
        setCopyState({ kind: 'failed', text: command })
      }
    })()
  }
  const doctorCommand = face.doctorCommand ?? DOCTOR_COMMAND
  useEffect(() => { store.start(); return () => { store.dispose() } }, [store])
  useEffect(() => {
    const onFocus = (): void => { store.refresh() }
    const onVisibility = (): void => { if (document.visibilityState === 'visible') store.refresh() }
    const onRefresh = (): void => { store.refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('evolution-merge:refresh', onRefresh)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('evolution-merge:refresh', onRefresh) }
  }, [store])
  const view = snapshot.view
  const fallback = [...new Set([...view.commands, ...FALLBACK_COMMANDS])]
  const blocked = snapshot.viewState === 'blocked' && snapshot.viewFailure !== undefined ? snapshot.viewFailure : undefined
  const viewFailure = snapshot.viewState === 'error' ? snapshot.viewFailure : undefined
  const queue: QueueState = snapshot.current
  const uiState = blocked !== undefined ? 'blocked' : viewFailure !== undefined ? 'error' : snapshot.viewState === 'loading' ? 'loading' : queue.status === 'error' ? 'error' : queue.status === 'loading' ? 'loading' : queue.status === 'empty' ? 'empty' : 'ready'
  const orderKey = rowOrderKey(workspaceId, snapshot.queue, snapshot.expiredOnly)
  const visibleOrder = orders[orderKey] ?? orderStore.read(workspaceId, snapshot.queue, snapshot.expiredOnly)
  const visibleRows = orderRows(queue.rows, visibleOrder)
  const saveOrder = (ids: readonly string[]): void => {
    setOrders(previous => ({ ...previous, [orderKey]: ids }))
    orderStore.write(workspaceId, snapshot.queue, ids, snapshot.expiredOnly)
  }
  const sortHandlers: RowSortHandlers = {
    start: (id) => { setDragId(id) },
    over: () => {},
    end: () => { setDragId(undefined) },
    drop: (targetId) => {
      const fromId = dragId
      setDragId(undefined)
      if (fromId === undefined || fromId === targetId) return
      saveOrder(moveRow(visibleRows.map(row => row.id), fromId, targetId))
    },
    menu: (id, x, y) => { setMenu({ id, x, y }) },
  }
  const pinMenu = (edge: RowOrderEdge): void => {
    if (menu === undefined) return
    saveOrder(pinRow(visibleRows.map(row => row.id), menu.id, edge))
    setMenu(undefined)
  }
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, current: (typeof QUEUES)[number]): void => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const isEdge = event.key === 'Home' || event.key === 'End'
    if (delta === 0 && !isEdge) return
    event.preventDefault()
    const index = QUEUES.indexOf(current)
    const next = event.key === 'Home' ? QUEUES[0]! : event.key === 'End' ? QUEUES[QUEUES.length - 1]! : QUEUES[(index + delta + QUEUES.length) % QUEUES.length]!
    store.select(next)
    requestAnimationFrame(() => { document.getElementById('merge-tab-' + next)?.focus() })
  }
  const tabs = createElement('div', { 'data-role': 'tabs', role: 'tablist' }, QUEUES.map(item => createElement('button', {
    key: item, id: 'merge-tab-' + item, type: 'button', role: 'tab', 'aria-selected': snapshot.queue === item ? 'true' : 'false', 'aria-controls': 'merge-rows', tabIndex: snapshot.queue === item ? 0 : -1, 'data-role': 'tab', 'data-active': snapshot.queue === item ? 'true' : 'false',
    onClick: () => { setMenu(undefined); store.select(item) },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => { onTabKey(event, item) },
  }, t('tab.' + item) + ' ' + String(view.counts[item]))))
  const expiredToggle = snapshot.queue === 'pending' ? createElement('button', {
    type: 'button', role: 'switch', 'aria-checked': snapshot.expiredOnly ? 'true' : 'false', 'data-role': 'expired-toggle', 'data-active': snapshot.expiredOnly ? 'true' : 'false', onClick: () => { store.toggleExpired() },
  }, t('tab.expired') + ' ' + String(view.expired)) : null
  const notice = decisionNotice === undefined ? null : createElement('p', { 'data-role': 'decision-notice', 'data-ok': decisionNotice.ok ? 'true' : 'false' }, decisionNotice.message)
  const taskBanner = view.counts.pending > 0
    ? createElement(TaskBanner, { count: view.counts.pending, text: t('task.pending') })
    : null
  const list = uiState === 'ready' && queue.status === 'ready' ? createElement('div', { 'data-role': 'rows', id: 'merge-rows', role: 'tabpanel' }, visibleRows.map(row => createElement(MergeRow, { row, t, copy, sort: sortHandlers, openBoth, onDecide: face.decide === undefined ? undefined : decideRow, busy: deciding === row.id }))) : null
  const empty = uiState === 'empty' ? createElement('div', null, createElement('p', { 'data-role': 'note' }, t('empty.' + snapshot.queue)), createElement('p', { 'data-role': 'empty-scope' }, t('empty.scope'))) : null
  const staleViewFailure = snapshot.viewState === 'ready' ? snapshot.viewFailure : undefined
  const activeFailure = viewFailure !== undefined ? viewFailure : staleViewFailure !== undefined ? staleViewFailure : queue.status === 'error' ? queue.failure : undefined
  const overlay = snapshot.overlay
  const menuStyle = menu === undefined ? undefined : {
    position: 'fixed', zIndex: 70, minWidth: '160px', maxWidth: 'min(320px, calc(100vw - 16px))',
    left: String(Math.min(menu.x, Math.max(0, (globalThis.innerWidth || 1440) - 180))) + 'px',
    top: String(Math.min(menu.y, Math.max(0, (globalThis.innerHeight || 800) - 110))) + 'px',
  }
  const menuNode = menu === undefined ? null : PLATFORM_MENU === undefined
    ? createElement('div', { 'data-role': 'sort-menu', role: 'menu', 'aria-label': t('sort.menu'), style: menuStyle },
        createElement('button', { type: 'button', role: 'menuitem', 'data-role': 'sort-pin-top', onClick: () => { pinMenu('top') } }, t('sort.pinTop')),
        createElement('button', { type: 'button', role: 'menuitem', 'data-role': 'sort-pin-bottom', onClick: () => { pinMenu('bottom') } }, t('sort.pinBottom')),
        createElement('button', { type: 'button', role: 'menuitem', 'data-role': 'sort-cancel', onClick: () => { setMenu(undefined) } }, t('sort.cancel')),
      )
    : renderPlatformMenu(PLATFORM_MENU, [
        { id: 'sort-pin-top', label: t('sort.pinTop'), onSelect: () => { pinMenu('top') } },
        { id: 'sort-pin-bottom', label: t('sort.pinBottom'), onSelect: () => { pinMenu('bottom') } },
        { id: 'sort-cancel', label: t('sort.cancel'), separatorBefore: true, onSelect: () => { setMenu(undefined) } },
      ], t('sort.menu'), menuStyle as Record<string, string | number>)
  return createElement('section', { className: CSS_TAG_ID, 'data-state': uiState },
    createElement('h2', { 'data-role': 'title' }, t('title')),
    createElement('p', { 'data-role': 'hint' }, t('hint')),
    blocked !== undefined
      ? failureNode(t, blocked, fallback, copy)
      : createElement('div', { 'data-role': 'content' },
          taskBanner,
          snapshot.viewState === 'loading' || queue.status === 'loading' ? createElement('p', { 'data-role': 'note' }, t('loading')) : queue.refreshing === true ? createElement('p', { 'data-role': 'note', role: 'status' }, t('refreshing')) : null,
          activeFailure === undefined ? null : failureNode(t, activeFailure, fallback, copy),
          copyState.kind === 'idle' ? null : copyState.kind === 'copied'
            ? createElement('p', { 'data-role': 'copied', role: 'status' }, t('copied') + ' ' + (copyState.text ?? ''))
            : createElement('div', { 'data-role': 'copy-failed', role: 'alert' },
              createElement('p', null, t('copyFailed')),
              copyState.text === undefined ? null : createElement('code', { 'data-role': 'copy-failed-command' }, copyState.text),
              createElement('button', { type: 'button', 'data-role': 'copy-retry', onClick: () => { if (copyState.text !== undefined) copy(copyState.text) } }, t('copyRetry')),
            ),
          notice,
          list,
          tabs,
          expiredToggle,
          empty,
          queue.nextCursor === undefined || uiState !== 'ready' ? null : createElement('button', { type: 'button', 'data-role': 'load-more', disabled: queue.status === 'loading', onClick: () => { store.loadMore() } }, t('loadMore')),
          createElement(MergeSettings, { view, t }),
          createElement(MergeRunStrips, { view, t, copy }),
          view.degraded ? createElement('p', { 'data-role': 'degraded' }, t('degraded') + ' ' + view.notes.join(',')) : null,
          createElement('div', { 'data-role': 'start' },
            createElement('button', { type: 'button', 'data-role': 'start-scan', onClick: () => { copy(view.startCommands.scan) } }, t('start.scan')),
            createElement('button', { type: 'button', 'data-role': 'start-pair', onClick: () => { copy(view.startCommands.pair) } }, t('start.pair')),
          ),
          createElement('button', { type: 'button', 'data-role': 'history', onClick: () => { openHistory() } }, t('history')),
          createElement('button', { type: 'button', 'data-role': 'doctor', onClick: () => { copy(doctorCommand) } }, t('doctor.open')),
          overlay === undefined ? null : overlay.kind === 'body' ? bodyNode(overlay, t, closeOverlay) : overlay.kind === 'pair' ? pairNode(overlay, t, closeOverlay) : historyNode(overlay, t, closeOverlay),
          createElement('button', { type: 'button', 'data-role': 'refresh', onClick: () => { store.refresh() } }, t('refresh')),
          menuNode,
        ),
  )
}
