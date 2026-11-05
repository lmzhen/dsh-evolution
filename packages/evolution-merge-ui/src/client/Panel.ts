/** Batch 4 merge panel: keyed read store, four tabs, local overlays, localized errors. */
import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { CSS_TAG_ID } from './styles.ts'
import { platformModal } from './platform-modal.ts'
import { PLATFORM_MENU, renderPlatformMenu } from './platform-menu.ts'
import { isBlocked, type MergeFailure, type MergeProblem, type MergeQueue, type MergeRowView, type MergeRunView, type MergeViewPayload } from './api.ts'
import type { MergeStore, OverlayState, QueueState, StoreSnapshot } from './MergeStore.ts'
import type { SettingsFace } from '@lmzhen/dsh-evolution-client-kit'
import { createRowOrderStore, moveRow, orderRows, pinRow, resolveWorkspaceId, rowOrderKey, type RowOrderEdge } from './sorting.ts'
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
function summaryNode(row: MergeRowView, t: Translate): ReactNode {
  if (row.state !== 'pending' || row.summary === undefined) return null
  const slots: readonly [string, string | null][] = [['row.summaryA', row.summary.a], ['row.summaryB', row.summary.b], ['row.rationale', row.summary.rationale]]
  return createElement('div', { 'data-role': 'pending-summary' }, slots.map(([label, value]) =>
    createElement('div', { key: label, 'data-role': 'pending-summary-slot' },
      createElement('span', { 'data-role': 'pending-summary-label' }, t(label)),
      createElement('span', { 'data-role': 'pending-summary-value' }, value === null || value === '' ? t('row.noSummary') : value),
    ),
  ))
}
function stageNode(row: MergeRowView, t: Translate): ReactNode {
  const stage = row.stageView
  if (stage === undefined) return null
  const tone = stage.state === 'lost' ? 'fail' : stage.state === 'expired' || stage.state === 'reserved' ? 'warn' : 'neutral'
  const expiry = stage.expiresAt === undefined ? '' : ' · ' + t('row.expires') + ' ' + new Date(stage.expiresAt).toLocaleString()
  return createElement('span', { 'data-role': 'stage-badge', 'data-stage': stage.state, 'data-tone': tone }, t('stage.state.' + stage.state) + expiry)
}
function runNode(view: MergeViewPayload, t: Translate, copy: (command: string) => void): ReactNode {
  const active = view.activeRun
  const last = view.lastRun
  if (active === undefined && last === undefined) return null
  return createElement('div', { 'data-role': 'run-strips' },
    active === undefined ? null : runStrip(active, t, copy, 'active'),
    last === undefined ? null : runStrip(last, t, copy, 'last'))
}
function runStrip(run: MergeRunView, t: Translate, copy: (command: string) => void, role: 'active' | 'last'): ReactNode {
  const report = run.actions.find(action => action.id === 'report')
  const reportEnabled = report?.enabled === true
  const internals = [
    createElement('span', { key: 'id', 'data-role': 'run-id', title: run.id }, t('run.id') + ' ' + run.id),
    run.stage === undefined ? null : createElement('span', { key: 'stage', 'data-role': 'run-stage' }, t('stage.' + run.stage)),
    run.endedAt === undefined ? null : createElement('span', { key: 'ended', 'data-role': 'run-ended' }, t('run.endedAt') + ' ' + new Date(run.endedAt).toLocaleString()),
    run.failure === undefined ? null : createElement('span', { key: 'failure', 'data-role': 'run-failure', title: run.failure.detail }, t('run.failure') + ' ' + run.failure.code),
    run.currentPairKey === undefined ? null : createElement('span', { key: 'pair', 'data-role': 'run-current-pair' }, t('run.currentPair') + ' ' + run.currentPairKey),
    run.parentRunId === undefined ? null : createElement('span', { key: 'parent', 'data-role': 'run-parent' }, t('run.parent') + ' ' + run.parentRunId),
    run.resultRef === undefined ? null : createElement('span', { key: 'ref', 'data-role': 'run-result-ref', title: run.resultRef }, t('run.resultRef')),
  ]
  return createElement('div', { 'data-role': 'run-strip', 'data-run-role': role, 'data-run-state': run.state },
    createElement('span', { 'data-role': 'run-state' }, t('run.state') + ' ' + t('run.' + run.state)),
    run.progress === null || run.progress === undefined ? null : createElement('span', { 'data-role': 'run-progress' }, t('run.progress') + ' ' + String(run.progress.done) + '/' + String(run.progress.total)),
    createElement('button', { type: 'button', 'data-role': 'run-report', 'data-action': 'report', disabled: !reportEnabled, title: reportEnabled ? (report?.command ?? t('run.report')) : t('run.noReport'), onClick: () => { if (reportEnabled && report !== undefined) copy(report.command) } }, t('run.report')),
    ...run.actions.filter(action => action.id !== 'report').map(action => createElement('button', {
      key: action.id, type: 'button', 'data-role': 'run-action', 'data-action': action.id, disabled: !action.enabled,
      title: action.disabledReason === undefined ? action.command : t('disabled.' + action.disabledReason),
      onClick: () => { if (action.enabled) copy(action.command) },
    }, t('action.' + action.id))),
    createElement('details', { 'data-role': 'run-details' },
      createElement('summary', null, t('run.details')),
      ...internals),
  )
}

function ReadOnlySetting({ section, label, value, disabled, missing, note, link, t }: { section: string; label: string; value: boolean | undefined; disabled: boolean; missing: boolean; note?: string; link?: boolean; t: Translate }): ReactNode {
  const text = missing ? t('settings.capabilityMissing') : disabled ? t('settings.capabilityDisabled') : value === true ? t('settings.on') : t('settings.off')
  return createElement('div', { 'data-role': 'settings-section', 'data-section': section, 'data-disabled': missing || disabled ? 'true' : 'false' },
    createElement('span', { 'data-role': 'settings-label' }, label),
    createElement('span', { 'data-role': 'settings-value', 'data-value': missing ? 'missing' : disabled ? 'unavailable' : value === true ? 'on' : 'off' }, text),
    note === undefined ? null : createElement('span', { 'data-role': 'settings-note' }, note),
    link === true ? createElement('span', { 'data-role': 'settings-link' }, t('settings.openPlatformPath')) : null,
  )
}
function SettingsCard({ view, t }: { view: MergeViewPayload; t: Translate }): ReactNode {
  const platform = view.approval.platformWrite
  const platformCapability = platform?.capability === true
  const platformFallback = platform?.enabled ?? false
  const mergeFallback = view.approval.mergeApproval
  return createElement('div', { 'data-role': 'settings-card' },
    createElement('h3', { 'data-role': 'settings-title' }, t('settings.title')),
    createElement('p', { 'data-role': 'settings-hint' }, t('settings.hint')),
    createElement('p', { 'data-role': 'settings-path' }, t('settings.openPlatformPath')),
    createElement(ReadOnlySetting, { section: 'merge-approval', label: t('settings.mergeApproval'), value: mergeFallback, disabled: false, missing: false, t }),
    createElement(ReadOnlySetting, { section: 'platform-write', label: t('settings.platformWrite'), value: platformFallback, disabled: platformCapability === false, missing: platform === undefined, note: t('settings.platformWriteLinkHint'), t }),
    createElement('p', { 'data-role': 'settings-readonly' }, t('settings.readonly')),
  )
}
interface RowSortHandlers {
  start(id: string): void
  over(event: DragEvent<HTMLDivElement>): void
  drop(id: string): void
  end(): void
  menu(id: string, x: number, y: number): void
}
function rowNode(row: MergeRowView, t: Translate, copy: (command: string) => void, sort: RowSortHandlers, openBody: (name: string, side: 'live' | 'archive', rowId: string | undefined) => void, onDecide: ((rowId: string, verb: 'approve' | 'reject') => void) | undefined, busy: boolean): ReactNode {
  const first = [
    row.target === undefined ? undefined : t('row.target') + ' ' + row.target,
    row.failure === undefined ? undefined : t('row.failure') + ' ' + row.failure.code + (row.failure.retryable ? '' : ' · ' + t('row.noRetry')),
    row.expired === undefined ? undefined : t('row.expired') + ' ' + t('expired.' + row.expired),
    row.reasonCode === undefined && row.reason === undefined ? undefined : t('row.reason') + ' ' + reasonText(t, row.reasonCode, row.reason ?? ''),
  ].filter((value): value is string => value !== undefined).join(' · ')
  const details = [
    t('row.id') + ' ' + row.id,
    row.targetActual === undefined ? undefined : t('row.actualTarget') + ' ' + row.targetActual,
    row.verifySubState === undefined ? undefined : t('row.verify') + ' ' + t('verify.' + row.verifySubState),
    row.origin === undefined ? undefined : t('row.origin') + ' ' + t('origin.' + row.origin),
    row.attempts === undefined ? undefined : t('row.attempts') + ' ' + String(row.attempts),
    row.confidence === undefined ? undefined : t('row.confidence') + ' ' + row.confidence.toFixed(2),
  ].filter((value): value is string => value !== undefined).join(' · ')
  const actions = row.actions.flatMap(action => {
    const decision = (action.id === 'approve' || action.id === 'reject') && onDecide !== undefined
    const primary = createElement('button', {
      key: action.id, type: 'button', 'data-role': decision ? 'row-decision' : 'row-action', 'data-action': action.id,
      ...(action.disabledReason === undefined ? {} : { 'data-disabled-reason': action.disabledReason }),
      title: action.command,
      disabled: !action.enabled || busy,
      onClick: () => {
        if (!action.enabled || busy) return
        if (decision) onDecide!(row.id, action.id as 'approve' | 'reject')
        else copy(action.command)
      },
    }, decision ? t('decision.' + action.id) : t('action.' + action.id))
    if (!decision) return [primary]
    return [primary, createElement('button', {
      key: action.id + '-copy', type: 'button', 'data-role': 'row-copy', 'data-action': action.id + '-copy',
      title: action.command, disabled: busy, onClick: () => { if (!busy) copy(action.command) },
    }, t('row.copy'))]
  })
  return createElement('div', {
    key: row.id, 'data-role': 'row', 'data-row-id': row.id, 'data-row-state': row.state, 'data-row-queue': row.queue,
    draggable: true, tabIndex: 0, title: t('sort.drag'), 'aria-haspopup': 'menu',
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
      event.preventDefault()
      const box = event.currentTarget.getBoundingClientRect()
      sort.menu(row.id, box.left + 12, box.top + 12)
    },
    onDragStart: (event: DragEvent<HTMLDivElement>) => { if (event.dataTransfer != null) { event.dataTransfer.setData('text/plain', row.id); event.dataTransfer.effectAllowed = 'move' } sort.start(row.id) },
    onDragOver: (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); if (event.dataTransfer != null) event.dataTransfer.dropEffect = 'move'; sort.over(event) },
    onDrop: (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); sort.drop(row.id) },
    onDragEnd: () => { sort.end() },
    onContextMenu: (event: MouseEvent<HTMLDivElement>) => { event.preventDefault(); sort.menu(row.id, event.clientX, event.clientY) },
  },
    createElement('div', null,
      createElement('div', { 'data-role': 'row-label' }, row.label),
      createElement('div', { 'data-role': 'row-meta' }, t('state.' + row.state) + (row.stage === null ? '' : ' · ' + t('stage.' + row.stage))),
      stageNode(row, t),
      summaryNode(row, t),
      first === '' ? null : createElement('div', { 'data-role': 'row-facts' }, first),
      createElement('details', { 'data-role': 'row-details' }, createElement('summary', null, t('row.details')), createElement('p', null, details)),
    ),
    createElement('div', null,
      createElement('div', { 'data-role': 'row-meta' }, new Date(row.updatedAt).toLocaleString()),
      createElement('div', { 'data-role': 'row-actions' },
        createElement('button', {
          type: 'button', 'data-role': 'row-sort', 'aria-haspopup': 'menu', title: t('sort.menu'),
          onClick: (event: MouseEvent<HTMLButtonElement>) => {
            const rect = event.currentTarget.getBoundingClientRect()
            sort.menu(row.id, rect.left, rect.bottom)
          },
        }, t('sort.menu')),
        (() => {
          const bodyA = row.bodies?.find(body => body.name === row.a)
          const bodyB = row.bodies?.find(body => body.name === row.b)
          return [
            bodyA === undefined ? null : createElement('button', { key: 'a', type: 'button', 'data-role': 'body-a', 'aria-label': t('body.' + bodyA.side) + ' ' + bodyA.name, title: t('body.' + bodyA.side) + ' ' + bodyA.name, onClick: () => { openBody(bodyA.name, bodyA.side, bodyA.rowId) } }, 'A · ' + bodyA.name),
            bodyB === undefined ? null : createElement('button', { key: 'b', type: 'button', 'data-role': 'body-b', 'aria-label': t('body.' + bodyB.side) + ' ' + bodyB.name, title: t('body.' + bodyB.side) + ' ' + bodyB.name, onClick: () => { openBody(bodyB.name, bodyB.side, bodyB.rowId) } }, 'B · ' + bodyB.name),
          ]
        })(),
        actions,
      ),
    ),
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
            item.name + ' · ' + (() => { const kind = t('history.kind.' + item.kind); const reason = reasonText(t, item.reasonCode, item.reason); return kind === reason ? kind : kind + ' · ' + reason })() + ' · v' + String(item.lastVersion) + ' · ' + (item.archivedAt === null ? t('history.archivedAtUnknown') : t('history.archivedAt', { date: new Date(item.archivedAt).toLocaleString() })),
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
  const openBody = (name: string, side: 'live' | 'archive', rowId: string | undefined): void => { captureFocus(); void store.openBody(name, side, rowId) }
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
  const list = uiState === 'ready' && queue.status === 'ready' ? createElement('div', { 'data-role': 'rows', id: 'merge-rows', role: 'tabpanel' }, visibleRows.map(row => rowNode(row, t, copy, sortHandlers, openBody, face.decide === undefined ? undefined : decideRow, deciding === row.id))) : null
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
          createElement('div', { 'data-role': 'start' },
            createElement('button', { type: 'button', 'data-role': 'start-scan', onClick: () => { copy(view.startCommands.scan) } }, t('start.scan')),
            createElement('button', { type: 'button', 'data-role': 'start-pair', onClick: () => { copy(view.startCommands.pair) } }, t('start.pair')),
          ),
          view.degraded ? createElement('p', { 'data-role': 'degraded' }, t('degraded') + ' ' + view.notes.join(',')) : null,
          createElement(SettingsCard, { view, t }),
          runNode(view, t, copy),
          tabs,
          expiredToggle,
          snapshot.viewState === 'loading' || queue.status === 'loading' ? createElement('p', { 'data-role': 'note' }, t('loading')) : queue.refreshing === true ? createElement('p', { 'data-role': 'note', role: 'status' }, t('refreshing')) : null,
          activeFailure === undefined ? null : failureNode(t, activeFailure, fallback, copy),
          copyState.kind === 'idle' ? null : copyState.kind === 'copied'
            ? createElement('p', { 'data-role': 'copied', role: 'status' }, t('copied') + ' ' + (copyState.text ?? ''))
            : createElement('p', { 'data-role': 'copy-failed', role: 'alert' }, t('copyFailed')),
          notice,
          list,
          empty,
          queue.nextCursor === undefined || uiState !== 'ready' ? null : createElement('button', { type: 'button', 'data-role': 'load-more', disabled: queue.status === 'loading', onClick: () => { store.loadMore() } }, t('loadMore')),
          createElement('button', { type: 'button', 'data-role': 'history', onClick: () => { openHistory() } }, t('history')),
          createElement('button', { type: 'button', 'data-role': 'doctor', onClick: () => { copy(doctorCommand) } }, t('doctor.open')),
          overlay === undefined ? null : overlay.kind === 'body' ? bodyNode(overlay, t, closeOverlay) : historyNode(overlay, t, closeOverlay),
          createElement('button', { type: 'button', 'data-role': 'refresh', onClick: () => { store.refresh() } }, t('refresh')),
          menuNode,
        ),
  )
}
