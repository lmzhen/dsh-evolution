/**
 * The merge panel body: three queues, counts, and a read-only row list. Actions are
 * intentionally copied commands, not buttons that write from the browser.
 */
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { CSS_TAG_ID } from './styles.ts'
import type { MergeBody, MergeHistoryItem, MergeOutcome, MergeQueue, MergeRowView, MergeViewPayload, QueuePage } from './api.ts'
import type { RouteFailure } from './route-client.generated.ts'
import { FailureBlock } from './states.generated.ts'
import { FALLBACKS } from './fallbacks.generated.ts'

export interface MergeFace {
  view: MergeViewPayload
  rows: MergeRowView[]
  loadView?: () => Promise<MergeOutcome<MergeViewPayload>>
  loadRows?: (queue: MergeQueue, cursor?: number) => Promise<MergeOutcome<QueuePage>>
  loadBody?: (id: string, side: 'a' | 'b') => Promise<MergeOutcome<MergeBody>>
  loadHistory?: () => Promise<MergeOutcome<{ items: MergeHistoryItem[] }>>
  t: (key: string) => string
}

const QUEUES: MergeQueue[] = ['verify', 'pending', 'fuse', 'skipped']

function failure(t: (key: string) => string, failure: RouteFailure): ReactNode {
  return FailureBlock({ failure, t, fallback: FALLBACKS['merge'] })
}

export function MergePanel(face: MergeFace): ReactNode {
  const t = face.t
  const [view, setView] = useState<MergeViewPayload>(face.view)
  const [tab, setTab] = useState<MergeQueue>('pending')
  const [rows, setRows] = useState<MergeRowView[]>(face.rows)
  const [loading, setLoading] = useState<boolean>(face.loadRows !== undefined || face.loadView !== undefined)
  const [failed, setFailed] = useState<RouteFailure | undefined>(undefined)
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [overlay, setOverlay] = useState<{ kind: 'body'; html: string; label: string } | { kind: 'history'; items: MergeHistoryItem[] } | undefined>(undefined)
  const request = useRef(0)

  const loadRows = (queue: MergeQueue, cursor = 0): void => {
    const load = face.loadRows
    if (load === undefined) return
    const token = request.current + 1
    request.current = token
    setLoading(true)
    load(queue, cursor).then((outcome) => {
      if (token !== request.current) return
      if (outcome.ok) {
        setRows(current => [
          ...(cursor === 0 ? [] : current),
          ...outcome.payload.items,
        ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
        setNextCursor(outcome.payload.nextCursor)
        setFailed(undefined)
      }
      else setFailed(outcome.failure)
    }).catch(() => { setFailed({ kind: 'server', status: 0 }) }).finally(() => { setLoading(false) })
  }

  const loadView = (): void => {
    const load = face.loadView
    if (load === undefined) return
    load().then((outcome) => {
      if (!outcome.ok) { setFailed(outcome.failure); return }
      if (outcome.payload.schemaVersion !== undefined && outcome.payload.schemaVersion !== 2) {
        setFailed({ kind: 'server', status: 0 }); return
      }
      setView(outcome.payload)
    }).catch(() => { setFailed({ kind: 'server', status: 0 }) })
  }

  const openBody = (id: string, side: 'a' | 'b'): void => {
    const load = face.loadBody
    if (load === undefined) return
    load(id, side).then((outcome) => {
      if (outcome.ok) setOverlay({ kind: 'body', html: outcome.payload.html, label: id + ':' + side })
      else setFailed(outcome.failure)
    }).catch(() => { setFailed({ kind: 'server', status: 0 }) })
  }

  const openHistory = (): void => {
    const load = face.loadHistory
    if (load === undefined) return
    load().then((outcome) => {
      if (outcome.ok) setOverlay({ kind: 'history', items: outcome.payload.items })
      else setFailed(outcome.failure)
    }).catch(() => { setFailed({ kind: 'server', status: 0 }) })
  }

  useEffect(() => { loadView(); loadRows('pending') }, [face])
  useEffect(() => { setNextCursor(undefined); loadRows(tab, 0) }, [tab])

  const counts = view.counts
  const stats = createElement('div', { 'data-role': 'stats' }, QUEUES.map(queue =>
    createElement('div', { key: queue, 'data-role': 'stat', 'data-queue': queue },
      createElement('div', { 'data-role': 'stat-value' }, String(counts[queue])),
      createElement('div', { 'data-role': 'stat-label' }, t('tab.' + queue)),
    ),
  ))
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
  const list = rows.length === 0
    ? createElement('p', { 'data-role': 'note' }, t('empty.' + tab))
    : createElement('div', { 'data-role': 'rows' }, rows.map((row) => {
      const facts = [
        row.target === undefined ? undefined : t('row.target') + ' ' + row.target,
        row.confidence === undefined ? undefined : t('row.confidence') + ' ' + row.confidence.toFixed(2),
        row.attempts === undefined ? undefined : t('row.attempts') + ' ' + String(row.attempts),
        row.origin === undefined ? undefined : t('row.origin') + ' ' + t('origin.' + row.origin),
        row.stagingExpiresAt === undefined ? undefined : t('row.expires') + ' ' + new Date(row.stagingExpiresAt).toLocaleString(),
        row.expired === undefined ? undefined : t('row.expired') + ' ' + row.expired,
        row.reason === undefined ? undefined : t('row.reason') + ' ' + row.reason,
        row.summary === undefined ? undefined : row.summary.filter(Boolean).join(' · '),
        row.failure === undefined ? undefined : t('row.failure') + ' ' + row.failure.message + (row.failure.retryable ? '' : ' · ' + t('row.noRetry')),
      ].filter((value): value is string => value !== undefined).join(' · ')
      return createElement('div', { key: row.id, 'data-role': 'row' },
        createElement('div', null,
          createElement('div', { 'data-role': 'row-label' }, row.label),
          createElement('div', { 'data-role': 'row-meta' }, t('state.' + row.state) + (row.stage === null ? '' : ' · ' + t('stage.' + row.stage))),
          facts === '' ? null : createElement('div', { 'data-role': 'row-facts' }, facts),
        ),
        createElement('div', null,
          createElement('div', { 'data-role': 'row-meta' }, row.updatedAt),
          createElement('div', { 'data-role': 'row-actions' },
            face.loadBody === undefined ? null : createElement('button', { type: 'button', 'data-role': 'body-a', onClick: () => { openBody(row.id, 'a') } }, 'A'),
            face.loadBody === undefined ? null : createElement('button', { type: 'button', 'data-role': 'body-b', onClick: () => { openBody(row.id, 'b') } }, 'B'),
            (row.actions ?? []).filter(action => view.approval !== false || !action.includes('/evolution merge approve')).map(action =>
            createElement('button', {
              key: action, type: 'button', 'data-role': 'row-action', title: action,
              onClick: () => { void navigator.clipboard.writeText(action) },
            }, t('row.copy')),
          )),
        ),
      )
    }))
  const uiState = loading ? 'loading' : failed !== undefined ? 'failed' : rows.length === 0 ? 'empty' : 'ready'
  return createElement('section', { className: CSS_TAG_ID, 'data-state': uiState },
    createElement('p', { 'data-role': 'hint' }, t('hint')),
    view.approval === undefined ? null : createElement('p', { 'data-role': 'approval' }, t(view.approval ? 'approval.on' : 'approval.off')),
    runStrip,
    stats,
    tabs,
    loading ? createElement('p', { 'data-role': 'note' }, t('loading')) : null,
    failed === undefined ? null : createElement('div', { 'data-role': 'note' }, failure(t, failed)),
    list,
    nextCursor === undefined ? null : createElement('button', { type: 'button', 'data-role': 'load-more', onClick: () => { loadRows(tab, Number(nextCursor)) } }, t('loadMore')),
    face.loadHistory === undefined ? null : createElement('button', { type: 'button', 'data-role': 'history', onClick: openHistory }, t('history')),
    overlay === undefined ? null : createElement('section', { 'data-role': 'overlay' },
      createElement('button', { type: 'button', 'data-role': 'overlay-close', onClick: () => { setOverlay(undefined) } }, t('close')),
      overlay.kind === 'body'
        ? createElement('div', { 'data-role': 'body', 'data-label': overlay.label, dangerouslySetInnerHTML: { __html: overlay.html } })
        : createElement('ul', { 'data-role': 'history-list' }, overlay.items.map(item => createElement('li', { key: item.name }, item.name + ' · ' + item.kind + ' · ' + item.reason + ' · v' + String(item.lastVersion)))),
    ),
    createElement('button', { type: 'button', 'data-role': 'refresh', onClick: () => { loadView(); loadRows(tab, 0) } }, t('refresh')),
  )
}
