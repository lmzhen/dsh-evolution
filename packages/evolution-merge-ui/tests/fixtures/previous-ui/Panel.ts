/**
 * The merge panel body: three queues, counts, and a read-only row list. Actions are
 * intentionally copied commands, not buttons that write from the browser.
 */
import { Fragment, createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { CSS_TAG_ID } from './styles.ts'
import type { MergeBlocked, MergeBody, MergeHistoryItem, MergeOutcome, MergeQueue, MergeRowView, MergeViewPayload, QueuePage } from './api.ts'
import type { RouteFailure } from './route-client.generated.ts'
import { FailureBlock } from './states.generated.ts'
import { FALLBACKS } from './fallbacks.generated.ts'

export interface MergeFace {
  view: MergeViewPayload
  rows: MergeRowView[]
  loadView?: () => Promise<MergeOutcome<MergeViewPayload>>
  loadRows?: (queue: MergeQueue, cursor?: string, expiredOnly?: boolean) => Promise<MergeOutcome<QueuePage>>
  loadBody?: (id: string, side: 'a' | 'b') => Promise<MergeOutcome<MergeBody>>
  loadHistory?: () => Promise<MergeOutcome<{ items: MergeHistoryItem[] }>>
  blocked?: MergeBlocked
  failed?: RouteFailure
  doctorCommand?: string
  t: (key: string) => string
}

const QUEUES: MergeQueue[] = ['verify', 'pending', 'fuse', 'skipped']

const blockedReasonKey = (blocked: MergeBlocked): string => {
  const code = blocked.readiness.code ?? blocked.code
  if (code.endsWith('needs-repair')) return 'blocked.reason.needs-repair'
  if (code.endsWith('forward-only')) return 'blocked.reason.forward-only'
  if (code.endsWith('migration-blocked')) return 'blocked.reason.migration-blocked'
  return 'blocked.reason.unknown'
}

function failure(t: (key: string) => string, failure: RouteFailure): ReactNode {
  if (failure.kind === 'refused' && failure.code === 'merge-body-missing') return FailureBlock({ failure: { ...failure, message: t('body.missing') }, t, fallback: FALLBACKS['merge'] })
  return FailureBlock({ failure, t, fallback: FALLBACKS['merge'] })
}

export function MergePanel(face: MergeFace): ReactNode {
  const t = face.t
  const [view, setView] = useState<MergeViewPayload>(face.view)
  const [tab, setTab] = useState<MergeQueue>('pending')
  const [expiredOnly, setExpiredOnly] = useState<boolean>(false)
  const [rows, setRows] = useState<MergeRowView[]>(face.rows)
  const [loading, setLoading] = useState<boolean>(face.loadRows !== undefined || face.loadView !== undefined)
  const [failed, setFailed] = useState<RouteFailure | undefined>(face.failed)
  const [blocked, setBlocked] = useState<MergeBlocked | undefined>(face.blocked)
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState<string | undefined>(undefined)
  const [overlay, setOverlay] = useState<{ kind: 'body'; html: string; label: string } | { kind: 'history'; items: MergeHistoryItem[] } | undefined>(undefined)
  const request = useRef(0)
  const copyCommand = (command: string): void => { void navigator.clipboard.writeText(command); setCopied(command) }

  const applyFailure = (failure: RouteFailure | MergeBlocked): void => {
    if (failure.kind === 'blocked') {
      setBlocked(failure)
      setFailed(undefined)
      setRows([])
      setNextCursor(undefined)
      setOverlay(undefined)
      return
    }
    setFailed(failure)
  }

  const loadRows = (queue: MergeQueue, cursor?: string, expired = false): void => {
    const load = face.loadRows
    if (load === undefined) return
    const token = request.current + 1
    request.current = token
    setLoading(true)
    load(queue, cursor, queue === 'pending' && expired).then((outcome) => {
      if (token !== request.current) return
      if (outcome.ok) {
        setBlocked(undefined)
        setRows(current => [
          ...(cursor === undefined ? [] : current),
          ...outcome.payload.items,
        ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
        setNextCursor(outcome.payload.nextCursor)
        setFailed(undefined)
      }
      else applyFailure(outcome.failure)
    }).catch(() => { setFailed({ kind: 'server', status: 0 }) }).finally(() => { setLoading(false) })
  }

  const loadView = (): void => {
    const load = face.loadView
    if (load === undefined) return
    load().then((outcome) => {
      if (!outcome.ok) { applyFailure(outcome.failure); return }
      setBlocked(undefined)
      setFailed(undefined)
      setView(outcome.payload)
    }).catch(() => { setFailed({ kind: 'server', status: 0 }) })
  }

  const openBody = (id: string, side: 'a' | 'b'): void => {
    const load = face.loadBody
    if (load === undefined) return
    load(id, side).then((outcome) => {
      if (outcome.ok) { setBlocked(undefined); setFailed(undefined); setOverlay({ kind: 'body', html: outcome.payload.html, label: id + ':' + side }) }
      else applyFailure(outcome.failure)
    }).catch(() => { setFailed({ kind: 'server', status: 0 }) })
  }

  const openHistory = (): void => {
    const load = face.loadHistory
    if (load === undefined) return
    load().then((outcome) => {
      if (outcome.ok) { setBlocked(undefined); setFailed(undefined); setOverlay({ kind: 'history', items: outcome.payload.items }) }
      else applyFailure(outcome.failure)
    }).catch(() => { setFailed({ kind: 'server', status: 0 }) })
  }

  useEffect(() => { loadView(); loadRows('pending') }, [face])
  useEffect(() => { if (tab !== 'pending' && expiredOnly) setExpiredOnly(false); setNextCursor(undefined); loadRows(tab, undefined, tab === 'pending' && expiredOnly) }, [tab, expiredOnly])

  const counts = view.counts
  const latest = view.latestRun
  const runStrip = latest === undefined ? null : createElement('div', { 'data-role': 'run-strip' },
    createElement('span', { 'data-role': 'run-id' }, latest.id),
    createElement('span', { 'data-role': 'run-state' }, latest.state),
    latest.stage === undefined ? null : createElement('span', { 'data-role': 'run-stage' }, t('stage.' + latest.stage)),
    latest.progress === undefined ? null : createElement('span', { 'data-role': 'run-progress' }, String(latest.progress.done) + '/' + String(latest.progress.total)),
  )
  const tabs = createElement('div', { 'data-role': 'tabs', role: 'tablist' }, QUEUES.map(queue =>
    createElement('button', {
      key: queue, type: 'button', role: 'tab', 'aria-selected': tab === queue ? 'true' : 'false', 'data-role': 'tab', 'data-active': tab === queue ? 'true' : 'false',
      onClick: () => { setTab(queue) },
    }, t('tab.' + queue) + ' ' + String(counts[queue])),
  ))
  const expiredToggle = tab === 'pending' ? createElement('button', {
    type: 'button', role: 'switch', 'aria-checked': expiredOnly ? 'true' : 'false', 'data-role': 'expired-toggle', 'data-active': expiredOnly ? 'true' : 'false',
    onClick: () => { setExpiredOnly(value => !value) },
  }, t('tab.expired') + ' ' + String(view.expired)) : null
  const list = rows.length === 0
    ? createElement('p', { 'data-role': 'note' }, t('empty.' + tab))
    : createElement('div', { 'data-role': 'rows' }, rows.map((row) => {
      const facts = [
        row.target === undefined ? undefined : t('row.target') + ' ' + row.target + (row.targetActual === undefined ? '' : ' → ' + row.targetActual) + (row.targetCreated === true ? ' (' + t('row.targetCreated') + ')' : ''),
        row.verifySubState === undefined ? undefined : t('row.verify') + ' ' + t('verify.' + row.verifySubState),
        row.stagingState === undefined || row.stagingState === 'none' ? undefined : t('row.staging') + ' ' + t('staging.' + row.stagingState),
        row.skipKind === undefined ? undefined : t('row.skipKind') + ' ' + t('skipKind.' + row.skipKind),
        row.bodies === undefined ? undefined : t('row.bodies') + ' ' + row.bodies.map(body => body.name + '(' + body.side + ')').join(', '),
        row.confidence === undefined ? undefined : t('row.confidence') + ' ' + row.confidence.toFixed(2),
        row.attempts === undefined ? undefined : t('row.attempts') + ' ' + String(row.attempts),
        row.origin === undefined ? undefined : t('row.origin') + ' ' + t('origin.' + row.origin),
        row.stagingExpiresAt === undefined ? undefined : t('row.expires') + ' ' + new Date(row.stagingExpiresAt).toLocaleString(),
        row.expired === undefined ? undefined : t('row.expired') + ' ' + t('expired.' + row.expired),
        row.reason === undefined ? undefined : t('row.reason') + ' ' + row.reason,
        row.summary === undefined ? undefined : (row.summary.filter(Boolean).join(' · ') || t('row.noSummary')),
        row.failure === undefined ? undefined : t('row.failure') + ' ' + row.failure.message + (row.failure.retryable ? '' : ' · ' + t('row.noRetry')),
      ].filter((value): value is string => value !== undefined).join(' · ')
      return createElement('div', { key: row.id, 'data-role': 'row' },
        createElement('div', null,
          createElement('div', { 'data-role': 'row-label' }, row.label),
          createElement('div', { 'data-role': 'row-meta' }, t('state.' + row.state) + (row.stage === null ? '' : ' · ' + t('stage.' + row.stage))),
          facts === '' ? null : createElement('div', { 'data-role': 'row-facts' }, facts),
        ),
        createElement('div', null,
          createElement('div', { 'data-role': 'row-meta' }, new Date(row.updatedAt).toLocaleString()),
          createElement('div', { 'data-role': 'row-actions' },
            face.loadBody === undefined || row.bodies === undefined ? null : createElement('button', { type: 'button', 'data-role': 'body-a', onClick: () => { openBody(row.id, 'a') } }, 'A'),
            face.loadBody === undefined || row.bodies === undefined ? null : createElement('button', { type: 'button', 'data-role': 'body-b', onClick: () => { openBody(row.id, 'b') } }, 'B'),
            (row.actions ?? []).map(action =>
              createElement('button', {
                key: action.id, type: 'button', 'data-role': 'row-action', 'data-action': action.id,
                ...(blocked === undefined ? {} : { 'data-disabled-reason': 'unavailable' }),
                title: blocked !== undefined ? t('disabled.unavailable') : action.disabledReason === undefined ? action.command : t('disabled.' + action.disabledReason),
                disabled: blocked !== undefined || !action.enabled,
                onClick: () => {
                  if (blocked !== undefined || !action.enabled) return
                  if (action.confirm && globalThis.confirm !== undefined && !globalThis.confirm(t('action.confirm') + ' ' + t('action.' + action.id))) return
                  copyCommand(action.command)
                },
              }, t('action.' + action.id)),
            )),
        ),
      )
    }))
  const blockedRawMessage = blocked === undefined || blocked.readiness.message === undefined || blocked.readiness.message === '' ? undefined : blocked.readiness.message
  const blockedReason = blocked === undefined ? '' : t(blockedReasonKey(blocked))
  const doctorCommand = face.doctorCommand ?? '/evolution doctor'
  const uiState = blocked !== undefined ? 'blocked' : loading ? 'loading' : failed !== undefined ? 'error' : rows.length === 0 ? 'empty' : 'ready'
  const blockedBanner = blocked === undefined ? null : createElement('div', {
    'data-role': 'blocked', role: 'alert',
    'data-block-code': blocked.code,
    'data-readiness-code': blocked.readiness.code ?? '',
  },
    createElement('h3', { 'data-role': 'blocked-title' }, t('blocked.title')),
    createElement('p', { 'data-role': 'blocked-reason', title: blockedRawMessage ?? blockedReason }, blockedReason),
    createElement('p', { 'data-role': 'blocked-hint' }, t('blocked.hint')),
    blockedRawMessage === undefined ? null : createElement('details', { 'data-role': 'blocked-detail' },
      createElement('summary', null, t('blocked.detail')),
      createElement('p', { 'data-role': 'blocked-raw' }, blockedRawMessage),
    ),
    createElement('div', { 'data-role': 'blocked-actions' },
      createElement('button', { type: 'button', 'data-role': 'doctor', title: doctorCommand, onClick: () => { copyCommand(doctorCommand) } }, t('blocked.doctor')),
      createElement('button', { type: 'button', 'data-role': 'refresh', onClick: () => { loadView(); loadRows(tab, undefined, tab === 'pending' && expiredOnly) } }, t('refresh')),
    ),
    copied === undefined ? null : createElement('p', { 'data-role': 'copied', role: 'status' }, t('copied') + ' ' + copied),
  )
  return createElement('section', { className: CSS_TAG_ID, 'data-state': uiState },
    createElement('h2', { 'data-role': 'title' }, t('title')),
    createElement('p', { 'data-role': 'hint' }, t('hint')),
    blocked === undefined
      ? createElement(Fragment, null,
          createElement('div', { 'data-role': 'start' },
            createElement('button', { type: 'button', 'data-role': 'start-scan', onClick: () => { copyCommand(view.startCommands.scan) } }, t('start.scan')),
            createElement('button', { type: 'button', 'data-role': 'start-pair', onClick: () => { copyCommand(view.startCommands.pair) } }, t('start.pair')),
          ),
          view.degraded ? createElement('p', { 'data-role': 'degraded' }, t('degraded') + ' ' + view.notes.join(',')) : null,
          view.approval === undefined ? null : createElement('p', { 'data-role': 'approval' }, t(view.approval ? 'approval.on' : 'approval.off')),
          runStrip,
          tabs,
          expiredToggle,
          loading ? createElement('p', { 'data-role': 'note' }, t('loading')) : null,
          failed === undefined ? null : createElement('div', { 'data-role': 'failure' },
            failure(t, failed),
            createElement('div', { 'data-role': 'fallback' }, view.commands.map(command =>
              createElement('button', { key: command, type: 'button', 'data-role': 'fallback-command', onClick: () => { copyCommand(command) } }, command),
            )),
          ),
          copied === undefined ? null : createElement('p', { 'data-role': 'copied', role: 'status' }, t('copied') + ' ' + copied),
          list,
          nextCursor === undefined ? null : createElement('button', { type: 'button', 'data-role': 'load-more', onClick: () => { loadRows(tab, nextCursor, expiredOnly) } }, t('loadMore')),
          face.loadHistory === undefined ? null : createElement('button', { type: 'button', 'data-role': 'history', onClick: openHistory }, t('history')),
          overlay === undefined ? null : createElement('section', { 'data-role': 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': overlay.kind === 'body' ? t('overlay.body') : t('history') },
            createElement('h3', { 'data-role': 'overlay-title' }, overlay.kind === 'body' ? t('overlay.body') : t('history')),
            createElement('button', { type: 'button', 'data-role': 'overlay-close', onClick: () => { setOverlay(undefined) } }, t('close')),
            overlay.kind === 'body'
              ? createElement('div', { 'data-role': 'body', 'data-label': overlay.label, dangerouslySetInnerHTML: { __html: overlay.html } })
              : overlay.items.length === 0
                ? createElement('p', { 'data-role': 'history-empty' }, t('history.empty'))
                : createElement('ul', { 'data-role': 'history-list' }, overlay.items.map(item => createElement('li', { key: item.name }, item.name + ' · ' + t('history.kind.' + item.kind) + ' · ' + item.reason + ' · v' + String(item.lastVersion)))),
          ),
        )
      : blockedBanner,
    blocked === undefined ? createElement('button', { type: 'button', 'data-role': 'refresh', onClick: () => { loadView(); loadRows(tab, undefined, tab === 'pending' && expiredOnly) } }, t('refresh')) : null,
  )
}
