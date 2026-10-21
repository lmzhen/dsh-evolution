/**
 * The merge panel body: three queues, counts, and a read-only row list. Actions are
 * intentionally copied commands, not buttons that write from the browser.
 */
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { CSS_TAG_ID } from './styles.ts'
import type { MergeOutcome, MergeQueue, MergeRowView, MergeViewPayload, QueuePage } from './api.ts'
import type { RouteFailure } from './route-client.generated.ts'
import { FailureBlock } from './states.generated.ts'
import { FALLBACKS } from './fallbacks.generated.ts'

export interface MergeFace {
  view: MergeViewPayload
  rows: MergeRowView[]
  loadView?: () => Promise<MergeOutcome<MergeViewPayload>>
  loadRows?: (queue: MergeQueue, cursor?: number) => Promise<MergeOutcome<QueuePage>>
  t: (key: string) => string
}

const QUEUES: MergeQueue[] = ['pending', 'retry', 'skipped']

function failure(t: (key: string) => string, failure: RouteFailure): ReactNode {
  return FailureBlock({ failure, t, fallback: FALLBACKS['merge'] })
}

export function MergePanel(face: MergeFace): ReactNode {
  const t = face.t
  const [view, setView] = useState<MergeViewPayload>(face.view)
  const [tab, setTab] = useState<MergeQueue>('pending')
  const [rows, setRows] = useState<MergeRowView[]>(face.rows)
  const [loading, setLoading] = useState<boolean>(false)
  const [failed, setFailed] = useState<RouteFailure | undefined>(undefined)
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)

  const loadRows = (queue: MergeQueue, cursor = 0): void => {
    const load = face.loadRows
    if (load === undefined) return
    setLoading(true)
    load(queue, cursor).then((outcome) => {
      if (outcome.ok) {
        setRows(current => [...(cursor === 0 ? [] : current), ...outcome.payload.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
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
      if (outcome.payload.schemaVersion !== undefined && outcome.payload.schemaVersion !== 1) {
        setFailed({ kind: 'server', status: 0 }); return
      }
      setView(outcome.payload)
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
    : createElement('div', { 'data-role': 'rows' }, rows.map(row => {
      const facts = [
        row.target === undefined ? undefined : t('row.target') + ' ' + row.target,
        row.confidence === undefined ? undefined : t('row.confidence') + ' ' + row.confidence.toFixed(2),
        row.attempts === undefined ? undefined : t('row.attempts') + ' ' + String(row.attempts),
        row.origin === undefined ? undefined : t('row.origin') + ' ' + t('origin.' + row.origin),
        row.stagingExpiresAt === undefined ? undefined : t('row.expires') + ' ' + new Date(row.stagingExpiresAt).toLocaleString(),
        row.failure === undefined ? undefined : t('row.failure') + ' ' + row.failure.message + (row.failure.retryable ? '' : ' · ' + t('row.noRetry')),
      ].filter((value): value is string => value !== undefined).join(' · ')
      return createElement('div', { key: row.id, 'data-role': 'row' },
        createElement('div', null,
          createElement('div', { 'data-role': 'row-label' }, row.label),
          createElement('div', { 'data-role': 'row-meta' }, row.state + (row.stage === null ? '' : ' · ' + t('stage.' + row.stage))),
          facts === '' ? null : createElement('div', { 'data-role': 'row-facts' }, facts),
        ),
        createElement('div', null,
          createElement('div', { 'data-role': 'row-meta' }, row.updatedAt),
          createElement('div', { 'data-role': 'row-actions' }, (row.actions ?? []).map(action =>
            createElement('button', {
              key: action, type: 'button', 'data-role': 'row-action', title: action,
              onClick: () => { void navigator.clipboard?.writeText(action) },
            }, t('row.copy')),
          )),
        ),
      )
    }))
  const uiState = loading ? 'loading' : failed !== undefined ? 'failed' : rows.length === 0 ? 'empty' : 'ready'
  return createElement('section', { className: CSS_TAG_ID, 'data-state': uiState },
    createElement('p', { 'data-role': 'hint' }, t('hint')),
    runStrip,
    stats,
    tabs,
    loading ? createElement('p', { 'data-role': 'note' }, t('loading')) : null,
    failed === undefined ? null : createElement('div', { 'data-role': 'note' }, failure(t, failed)),
    list,
    nextCursor === undefined ? null : createElement('button', { type: 'button', 'data-role': 'load-more', onClick: () => { loadRows(tab, Number(nextCursor)) } }, t('loadMore')),
    createElement('button', { type: 'button', 'data-role': 'refresh', onClick: () => { loadView(); loadRows(tab, 0) } }, t('refresh')),
  )
}
