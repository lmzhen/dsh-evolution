/** Batch 4 merge panel: keyed read store, four tabs, local overlays, localized errors. */
import { createElement, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { CSS_TAG_ID } from './styles.ts'
import { PLATFORM_MENU } from './platform-menu.ts'
import { isBlocked, type MergeFailure, type MergeProblem, type MergeQueue, type MergeRowView, type MergeViewPayload } from './api.ts'
import type { MergeStore, OverlayState, QueueState, StoreSnapshot } from './MergeStore.ts'
import type { ConfigFormLike, SettingsFace } from '@lmzhen/dsh-evolution-client-kit'
import { createRowOrderStore, moveRow, orderRows, pinRow, resolveWorkspaceId, rowOrderKey, type RowOrderEdge } from './sorting.ts'
import { FALLBACK_COMMANDS } from './fallbacks.ts'

export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string
export interface MergeFace { store: MergeStore; t: Translate; doctorCommand?: string; settings?: SettingsFace; workspaceId?: string }
export async function saveSetting(form: ConfigFormLike, field: string, value: boolean): Promise<boolean> {
  try { return await form.set(field, value) } catch { return false }
}
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
  const run = view.latestRun
  if (run === undefined) return null
  const report = run.actions.find(action => action.id === 'report')
  const reportEnabled = report?.enabled === true
  return createElement('div', { 'data-role': 'run-strip', 'data-run-state': run.state },
    createElement('span', { 'data-role': 'run-id', title: run.id }, t('run.id') + ' ' + run.id),
    createElement('span', { 'data-role': 'run-state' }, t('run.state') + ' ' + t('run.' + run.state)),
    run.stage === undefined ? null : createElement('span', { 'data-role': 'run-stage' }, t('stage.' + run.stage)),
    run.progress === null || run.progress === undefined ? null : createElement('span', { 'data-role': 'run-progress' }, t('run.progress') + ' ' + String(run.progress.done) + '/' + String(run.progress.total)),
    run.endedAt === undefined ? null : createElement('span', { 'data-role': 'run-ended' }, t('run.endedAt') + ' ' + new Date(run.endedAt).toLocaleString()),
    run.failure === undefined ? null : createElement('span', { 'data-role': 'run-failure', title: run.failure.detail }, t('run.failure') + ' ' + run.failure.code),
    run.currentPairKey === undefined ? null : createElement('span', { 'data-role': 'run-current-pair' }, t('run.currentPair') + ' ' + run.currentPairKey),
    run.parentRunId === undefined ? null : createElement('span', { 'data-role': 'run-parent' }, t('run.parent') + ' ' + run.parentRunId),
    run.resultRef === undefined ? null : createElement('span', { 'data-role': 'run-result-ref', title: run.resultRef }, t('run.resultRef')),
    createElement('button', { type: 'button', 'data-role': 'run-report', 'data-action': 'report', disabled: !reportEnabled, title: reportEnabled ? (report?.command ?? t('run.report')) : t('run.noReport'), onClick: () => { if (reportEnabled && report !== undefined) copy(report.command) } }, t('run.report')),
    ...run.actions.filter(action => action.id !== 'report').map(action => createElement('button', {
      key: action.id, type: 'button', 'data-role': 'run-action', 'data-action': action.id, disabled: !action.enabled,
      title: action.disabledReason === undefined ? action.command : t('disabled.' + action.disabledReason),
      onClick: () => { if (action.enabled) copy(action.command) },
    }, t('action.' + action.id))),
  )
}
function ReadOnlySetting({ section, label, value, disabled, missing, note, link, t }: { section: string; label: string; value: boolean | undefined; disabled: boolean; missing: boolean; note?: string; link?: boolean; t: Translate }): ReactNode {
  const text = missing ? t('settings.capabilityMissing') : disabled ? t('settings.capabilityDisabled') : value === true ? t('settings.on') : t('settings.off')
  return createElement('div', { 'data-role': 'settings-section', 'data-section': section, 'data-disabled': missing || disabled ? 'true' : 'false' },
    createElement('span', { 'data-role': 'settings-label' }, label),
    createElement('span', { 'data-role': 'settings-value', 'data-value': missing ? 'missing' : disabled ? 'unavailable' : value === true ? 'on' : 'off' }, text),
    note === undefined ? null : createElement('span', { 'data-role': 'settings-note' }, note),
    link === true ? createElement('a', { 'data-role': 'settings-link', href: '#/settings', onClick: () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', ctrlKey: true, altKey: true, bubbles: true })) } }, t('settings.openPlatform')) : null,
  )
}
function EditableSetting({ form, field, label, fallback, capability, t }: { form: ConfigFormLike; field: string; label: string; fallback: boolean; capability: boolean; t: Translate }): ReactNode {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const readSnapshot = useCallback(() => form['getSnapshot'](), [form])
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, readSnapshot)
  const fieldPresent = snapshot.status !== 'ready' || snapshot.value === undefined || Object.prototype.hasOwnProperty.call(snapshot.value, field)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<'saved' | 'failed' | undefined>(undefined)
  const value = snapshot.status === 'ready' && typeof snapshot.value?.[field] === 'boolean' ? snapshot.value[field] : fallback
  const disabled = !capability || busy || snapshot.status !== 'ready' || !snapshot.writable
  const toggle = async (): Promise<void> => {
    if (disabled) return
    setBusy(true)
    setSaved(undefined)
    const ok = await saveSetting(form, field, !value)
    setBusy(false)
    setSaved(ok ? 'saved' : 'failed')
  }
  if (!fieldPresent) return createElement(ReadOnlySetting, { section: 'platform-write', label, value: fallback, disabled: !capability, missing: false, note: t('settings.platformWriteLinkHint'), link: true, t })
  return createElement('div', { 'data-role': 'settings-section', 'data-section': field === 'mergeApproval' ? 'merge-approval' : 'platform-write', ...(disabled ? { 'data-disabled': 'true' } : {}) },
    createElement('label', { 'data-role': 'settings-label' }, label),
    createElement('input', {
      type: 'checkbox', role: 'switch', 'data-role': 'settings-toggle', 'data-field': field,
      'data-value': value ? 'on' : 'off', checked: value, disabled,
      onChange: () => { void toggle() },
    }),
    createElement('span', { 'data-role': 'settings-value' }, value ? t('settings.on') : t('settings.off')),
    ...(saved === undefined ? [] : [createElement('span', { 'data-role': 'settings-save-state', 'data-save': saved }, t(saved === 'saved' ? 'settings.saved' : 'settings.saveFailed'))]),
  )
}
function SettingsCard({ view, settings, t }: { view: MergeViewPayload; settings?: SettingsFace | undefined; t: Translate }): ReactNode {
  const platform = view.approval.platformWrite
  const platformCapability = platform?.capability ?? settings?.platform !== undefined
  const platformFallback = platform?.enabled ?? false
  const mergeCapability = settings?.merge !== undefined
  const mergeFallback = view.approval.mergeApproval
  return createElement('div', { 'data-role': 'settings-card' },
    createElement('h3', { 'data-role': 'settings-title' }, t('settings.title')),
    createElement('p', { 'data-role': 'settings-hint' }, t('settings.hint')),
    settings?.merge === undefined
      ? createElement(ReadOnlySetting, { section: 'merge-approval', label: t('settings.mergeApproval'), value: mergeFallback, disabled: false, missing: false, t })
      : createElement(EditableSetting, { form: settings.merge, field: 'mergeApproval', label: t('settings.mergeApproval'), fallback: mergeFallback, capability: mergeCapability, t }),
    createElement(ReadOnlySetting, { section: 'platform-write', label: t('settings.platformWrite'), value: platformFallback, disabled: platformCapability === false, missing: platform === undefined, note: t('settings.platformWriteLinkHint'), link: true, t }),
    settings?.merge === undefined
      ? createElement('a', { 'data-role': 'settings-link', href: '#/settings' }, t('settings.openPlatform'))
      : null,
    createElement('p', { 'data-role': 'settings-readonly' }, settings?.merge === undefined ? t('settings.readonly') : t('settings.live')),
  )
}
interface RowSortHandlers {
  start(id: string): void
  over(event: DragEvent<HTMLDivElement>): void
  drop(id: string): void
  end(): void
  menu(id: string, x: number, y: number): void
}
function rowNode(row: MergeRowView, store: MergeStore, t: Translate, copy: (command: string) => void, sort: RowSortHandlers): ReactNode {
  const facts = [
    row.target === undefined ? undefined : t('row.target') + ' ' + row.target,
    row.targetActual === undefined ? undefined : t('row.actualTarget') + ' ' + row.targetActual,
    row.verifySubState === undefined ? undefined : t('row.verify') + ' ' + t('verify.' + row.verifySubState),
    row.origin === undefined ? undefined : t('row.origin') + ' ' + t('origin.' + row.origin),
    row.attempts === undefined ? undefined : t('row.attempts') + ' ' + String(row.attempts),
    row.confidence === undefined ? undefined : t('row.confidence') + ' ' + row.confidence.toFixed(2),
    row.failure === undefined ? undefined : t('row.failure') + ' ' + row.failure.code + (row.failure.retryable ? '' : ' · ' + t('row.noRetry')),
    row.expired === undefined ? undefined : t('row.expired') + ' ' + t('expired.' + row.expired),
    row.reasonCode === undefined && row.reason === undefined ? undefined : t('row.reason') + ' ' + reasonText(t, row.reasonCode, row.reason ?? ''),
  ].filter((value): value is string => value !== undefined).join(' · ')
  const actions = row.actions.map(action => createElement('button', {
    key: action.id, type: 'button', 'data-role': 'row-action', 'data-action': action.id,
    ...(action.disabledReason === undefined ? {} : { 'data-disabled-reason': action.disabledReason }),
    title: action.disabledReason === undefined ? action.command : t('disabled.' + action.disabledReason),
    disabled: !action.enabled,
    onClick: () => {
      if (!action.enabled) return
      if (action.confirm && globalThis.confirm !== undefined && !globalThis.confirm(t('action.confirm') + ' ' + (t('action.' + action.id) || action.id))) return
      copy(action.command)
    },
  }, t('action.' + action.id)))
  return createElement('div', {
    key: row.id, 'data-role': 'row', 'data-row-id': row.id, 'data-row-state': row.state, 'data-row-queue': row.queue,
    draggable: true, title: t('sort.drag'),
    onDragStart: (event: DragEvent<HTMLDivElement>) => { if (event.dataTransfer != null) { event.dataTransfer.setData('text/plain', row.id); event.dataTransfer.effectAllowed = 'move' } sort.start(row.id) },
    onDragOver: (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); if (event.dataTransfer != null) event.dataTransfer.dropEffect = 'move'; sort.over(event) },
    onDrop: (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); sort.drop(row.id) },
    onDragEnd: () => { sort.end() },
    onContextMenu: (event: MouseEvent<HTMLDivElement>) => { event.preventDefault(); sort.menu(row.id, event.clientX, event.clientY) },
  },
    createElement('div', null,
      createElement('div', { 'data-role': 'row-label' }, row.label),
      createElement('div', { 'data-role': 'row-id', title: row.id }, t('row.id') + ' ' + row.id),
      createElement('div', { 'data-role': 'row-meta' }, t('state.' + row.state) + (row.stage === null ? '' : ' · ' + t('stage.' + row.stage))),
      stageNode(row, t),
      summaryNode(row, t),
      facts === '' ? null : createElement('div', { 'data-role': 'row-facts' }, facts),
    ),
    createElement('div', null,
      createElement('div', { 'data-role': 'row-meta' }, new Date(row.updatedAt).toLocaleString()),
      createElement('div', { 'data-role': 'row-actions' },
        (() => {
          const bodyA = row.bodies?.find(body => body.name === row.a)
          const bodyB = row.bodies?.find(body => body.name === row.b)
          return [
            bodyA === undefined ? null : createElement('button', { key: 'a', type: 'button', 'data-role': 'body-a', onClick: () => { void store.openBody(bodyA.name, bodyA.side, bodyA.rowId) } }, 'A'),
            bodyB === undefined ? null : createElement('button', { key: 'b', type: 'button', 'data-role': 'body-b', onClick: () => { void store.openBody(bodyB.name, bodyB.side, bodyB.rowId) } }, 'B'),
          ]
        })(),
        actions,
      ),
    ),
  )
}
function bodyNode(overlay: Extract<OverlayState, { kind: 'body' }>, t: Translate, onClose: () => void): ReactNode {
  return createElement('section', { 'data-role': 'overlay', 'data-overlay': 'body', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('overlay.body') },
    createElement('div', { 'data-role': 'overlay-head' },
      createElement('h3', { 'data-role': 'overlay-title' }, t('overlay.body') + ' · ' + overlay.name),
      createElement('button', { type: 'button', 'data-role': 'overlay-close', onClick: onClose }, t('close')),
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
}
function historyNode(overlay: Extract<OverlayState, { kind: 'history' }>, t: Translate, onClose: () => void): ReactNode {
  return createElement('section', { 'data-role': 'overlay', 'data-overlay': 'history', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('history') },
    createElement('div', { 'data-role': 'overlay-head' },
      createElement('h3', { 'data-role': 'overlay-title' }, t('history')),
      createElement('button', { type: 'button', 'data-role': 'overlay-close', onClick: onClose }, t('close')),
    ),
    overlay.status === 'loading' ? createElement('p', { 'data-role': 'overlay-loading' }, t('loading')) : null,
    overlay.status === 'error' && overlay.failure !== undefined ? failureNode(t, overlay.failure, [], () => {}) : null,
    overlay.status === 'ready'
      ? overlay.items === undefined || overlay.items.length === 0
        ? createElement('p', { 'data-role': 'history-empty' }, t('history.empty'))
        : createElement('ul', { 'data-role': 'history-list' }, overlay.items.map(item => createElement('li', { key: item.name + ':' + item.archivedAt, 'data-role': 'history-item' },
            item.name + ' · ' + (() => { const kind = t('history.kind.' + item.kind); const reason = reasonText(t, item.reasonCode, item.reason); return kind === reason ? kind : kind + ' · ' + reason })() + ' · v' + String(item.lastVersion),
          )))
      : null,
  )
}

export function MergePanel(face: MergeFace): ReactNode {
  const { store, t } = face
  const snapshot: StoreSnapshot = useSyncExternalStore(store.subscribe, store.read, store.read)
  const [copied, setCopied] = useState<string | undefined>(undefined)
  const [orders, setOrders] = useState<Record<string, readonly string[]>>({})
  const [dragId, setDragId] = useState<string | undefined>(undefined)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | undefined>(undefined)
  const workspaceId = resolveWorkspaceId(face.workspaceId)
  const orderStore = useMemo(() => createRowOrderStore(), [])
  const copy = (command: string): void => { void navigator.clipboard.writeText(command); setCopied(command) }
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
  const orderKey = rowOrderKey(workspaceId, snapshot.queue)
  const visibleOrder = orders[orderKey] ?? orderStore.read(workspaceId, snapshot.queue)
  const visibleRows = orderRows(queue.rows, visibleOrder)
  const saveOrder = (ids: readonly string[]): void => {
    setOrders(previous => ({ ...previous, [orderKey]: ids }))
    orderStore.write(workspaceId, snapshot.queue, ids)
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
  const tabs = createElement('div', { 'data-role': 'tabs', role: 'tablist' }, QUEUES.map(item => createElement('button', {
    key: item, type: 'button', role: 'tab', 'aria-selected': snapshot.queue === item ? 'true' : 'false', 'data-role': 'tab', 'data-active': snapshot.queue === item ? 'true' : 'false',
    onClick: () => { setMenu(undefined); store.select(item) },
  }, t('tab.' + item) + ' ' + String(view.counts[item]))))
  const expiredToggle = snapshot.queue === 'pending' ? createElement('button', {
    type: 'button', role: 'switch', 'aria-checked': snapshot.expiredOnly ? 'true' : 'false', 'data-role': 'expired-toggle', 'data-active': snapshot.expiredOnly ? 'true' : 'false', onClick: () => { store.toggleExpired() },
  }, t('tab.expired') + ' ' + String(view.expired)) : null
  const list = uiState === 'ready' && queue.status === 'ready' ? createElement('div', { 'data-role': 'rows' }, visibleRows.map(row => rowNode(row, store, t, copy, sortHandlers))) : null
  const empty = uiState === 'empty' ? createElement('div', null, createElement('p', { 'data-role': 'note' }, t('empty.' + snapshot.queue)), createElement('p', { 'data-role': 'empty-scope' }, t('empty.scope'))) : null
  const activeFailure = viewFailure !== undefined ? viewFailure : queue.status === 'error' ? queue.failure : undefined
  const overlay = snapshot.overlay
  const menuStyle = menu === undefined ? undefined : {
    position: 'fixed', zIndex: 70, minWidth: 'var(--evo-measure-read)',
    left: String(Math.min(menu.x, Math.max(0, (globalThis.innerWidth || 1440) - 180))) + 'px',
    top: String(Math.min(menu.y, Math.max(0, (globalThis.innerHeight || 800) - 110))) + 'px',
  }
  const menuNode = menu === undefined ? null : PLATFORM_MENU === undefined
    ? createElement('div', { 'data-role': 'sort-menu', role: 'menu', 'aria-label': t('sort.menu'), style: menuStyle },
        createElement('button', { type: 'button', role: 'menuitem', 'data-role': 'sort-pin-top', onClick: () => { pinMenu('top') } }, t('sort.pinTop')),
        createElement('button', { type: 'button', role: 'menuitem', 'data-role': 'sort-pin-bottom', onClick: () => { pinMenu('bottom') } }, t('sort.pinBottom')),
        createElement('button', { type: 'button', role: 'menuitem', 'data-role': 'sort-cancel', onClick: () => { setMenu(undefined) } }, t('sort.cancel')),
      )
    : createElement(PLATFORM_MENU.MenuSurface, { 'data-role': 'sort-menu', 'data-platform': 'true', role: 'menu', 'aria-label': t('sort.menu'), style: menuStyle },
        createElement(PLATFORM_MENU.MenuItemButton, { children: t('sort.pinTop'), onSelect: () => { pinMenu('top') } }),
        createElement(PLATFORM_MENU.MenuItemButton, { children: t('sort.pinBottom'), onSelect: () => { pinMenu('bottom') } }),
        createElement(PLATFORM_MENU.MenuItemButton, { children: t('sort.cancel'), separatorBefore: true, onSelect: () => { setMenu(undefined) } }),
      )
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
          createElement(SettingsCard, { view, settings: face.settings, t }),
          runNode(view, t, copy),
          tabs,
          expiredToggle,
          snapshot.viewState === 'loading' || queue.status === 'loading' ? createElement('p', { 'data-role': 'note' }, t('loading')) : null,
          activeFailure === undefined ? null : failureNode(t, activeFailure, fallback, copy),
          copied === undefined ? null : createElement('p', { 'data-role': 'copied', role: 'status' }, t('copied') + ' ' + copied),
          list,
          empty,
          queue.nextCursor === undefined || uiState !== 'ready' ? null : createElement('button', { type: 'button', 'data-role': 'load-more', disabled: queue.status === 'loading', onClick: () => { store.loadMore() } }, t('loadMore')),
          createElement('button', { type: 'button', 'data-role': 'history', onClick: () => { void store.openHistory() } }, t('history')),
          createElement('button', { type: 'button', 'data-role': 'doctor', onClick: () => { copy(doctorCommand) } }, t('doctor.open')),
          overlay === undefined ? null : overlay.kind === 'body' ? bodyNode(overlay, t, () => { store.closeOverlay() }) : historyNode(overlay, t, () => { store.closeOverlay() }),
          createElement('button', { type: 'button', 'data-role': 'refresh', onClick: () => { store.refresh() } }, t('refresh')),
          menuNode,
        ),
  )
}
