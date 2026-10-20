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

  const loadRows = (queue: MergeQueue): void => {
    const load = face.loadRows
    if (load === undefined) return
    setLoading(true)
    load(queue).then((outcome) => {
      if (outcome.ok) { setRows(outcome.payload.items); setFailed(undefined) }
      else setFailed(outcome.failure)
    }).catch(() => setFailed({ kind: 'server', status: 0 })).finally(() => setLoading(false))
  }

  const loadView = (): void => {
    const load = face.loadView
    if (load === undefined) return
    load().then((outcome) => { if (outcome.ok) setView(outcome.payload) }).catch(() => {})
  }

  useEffect(() => { loadView(); loadRows('pending') }, [face])
  useEffect(() => { loadRows(tab) }, [tab])

  const counts = view.counts
  const stats = createElement('div', { 'data-role': 'stats' }, QUEUES.map(queue =>
    createElement('div', { key: queue, 'data-role': 'stat', 'data-queue': queue },
      createElement('div', { 'data-role': 'stat-value' }, String(counts[queue])),
      createElement('div', { 'data-role': 'stat-label' }, t('tab.' + queue)),
    ),
  ))
  const tabs = createElement('div', { 'data-role': 'tabs' }, QUEUES.map(queue =>
    createElement('button', {
      key: queue, type: 'button', 'data-role': 'tab', 'data-active': tab === queue ? 'true' : 'false',
      onClick: () => setTab(queue),
    }, t('tab.' + queue) + ' ' + String(counts[queue])),
  ))
  const list = rows.length === 0
    ? createElement('p', { 'data-role': 'note' }, t('empty.' + tab))
    : createElement('div', { 'data-role': 'rows' }, rows.map(row => createElement('div', { key: row.id, 'data-role': 'row' },
      createElement('div', null,
        createElement('div', { 'data-role': 'row-label' }, row.label),
        createElement('div', { 'data-role': 'row-meta' }, row.state + (row.stage === null ? '' : ' · ' + t('stage.' + row.stage))),
      ),
      createElement('div', { 'data-role': 'row-meta' }, row.updatedAt),
    )))
  return createElement('section', { className: CSS_TAG_ID },
    createElement('p', { 'data-role': 'hint' }, t('hint')),
    stats,
    tabs,
    loading ? createElement('p', { 'data-role': 'note' }, t('loading')) : null,
    failed === undefined ? null : createElement('div', { 'data-role': 'note' }, failure(t, failed)),
    list,
    createElement('button', { type: 'button', 'data-role': 'refresh', onClick: () => { loadView(); loadRows(tab) } }, t('refresh')),
  )
}
