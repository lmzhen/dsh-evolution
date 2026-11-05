/** One merge row: summary, stage, facts, one primary decision and the copy/sort drawer. */
import { createElement, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { DecisionFrame, type PresentationAction } from '@lmzhen/dsh-evolution-client-kit'
import type { MergeRowView } from './api.ts'
import { summarizePair } from './merge-presentation.ts'

type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string

export interface RowSortHandlers {
  start(id: string): void
  over(event: DragEvent<HTMLDivElement>): void
  drop(id: string): void
  end(): void
  menu(id: string, x: number, y: number): void
}

function reasonText(t: Translate, reasonCode: string | undefined, fallback: string): string {
  return reasonCode === undefined ? fallback : t('history.reason.' + reasonCode)
}

function summaryNode(row: MergeRowView, t: Translate): ReactNode {
  if (row.state !== 'pending' || row.summary === undefined) return null
  const pair = summarizePair(row.summary.a, row.summary.b)
  const slots: [string, string | null][] = pair.kind === 'same'
    ? [[t('row.summaryBoth'), pair.text]]
    : pair.kind === 'missing'
      ? [[t('row.summaryBoth'), t('row.noSummary')]]
      : [[t('row.summaryA'), pair.a], [t('row.summaryB'), pair.b]]
  slots.push([t('row.rationale'), row.summary.rationale])
  return createElement('div', { 'data-role': 'pending-summary' }, slots.map(([label, value]) =>
    createElement('div', { key: label, 'data-role': 'pending-summary-slot' },
      createElement('span', { 'data-role': 'pending-summary-label' }, label),
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

/**
 * Render one row as a decision card. The approve action is the only primary; A/B, reject and
 * auxiliary sort/copy commands cannot borrow that weight.
 * @param props - row, translator, copier, sort hooks, body opener and decision callback.
 * @returns the row with drag/keyboard wiring and a separate more drawer.
 */
export function MergeRow(props: { row: MergeRowView; t: Translate; copy: (command: string) => void; sort: RowSortHandlers; openBody: (name: string, side: 'live' | 'archive', rowId: string | undefined) => void; onDecide: ((rowId: string, verb: 'approve' | 'reject') => void) | undefined; busy: boolean }): ReactNode {
  const { row, t, copy, sort, openBody, onDecide, busy } = props
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
  const approve = row.actions.find(action => action.id === 'approve')
  const reject = row.actions.find(action => action.id === 'reject')
  const bodyA = row.bodies?.find(body => body.name === row.a)
  const bodyB = row.bodies?.find(body => body.name === row.b)
  const primary: PresentationAction | undefined = approve === undefined ? undefined : {
    id: 'approve',
    label: t('decision.approve'),
    disabled: !approve.enabled || busy || onDecide === undefined,
    ...(approve.disabledReason === undefined ? {} : { attributes: { 'data-disabled-reason': approve.disabledReason } }),
    onSelect: () => { if (approve.enabled && !busy && onDecide !== undefined) onDecide(row.id, 'approve') },
  }
  const secondary: PresentationAction[] = []
  if (approve !== undefined && onDecide === undefined) secondary.push({
    id: 'approve', label: t('action.approve'), disabled: !approve.enabled || busy,
    attributes: { 'data-role': 'row-action' }, onSelect: () => { if (approve.enabled && !busy) copy(approve.command) },
  })
  if (reject !== undefined) secondary.push({
    id: 'reject',
    label: t('decision.reject'),
    disabled: !reject.enabled || busy || onDecide === undefined,
    ...(reject.disabledReason === undefined ? {} : { attributes: { 'data-disabled-reason': reject.disabledReason } }),
    onSelect: () => { if (reject.enabled && !busy && onDecide !== undefined) onDecide(row.id, 'reject') },
  })
  if (bodyA !== undefined) secondary.push({
    id: 'body-a', label: 'A · ' + bodyA.name, attributes: { 'data-role': 'body-a' },
    onSelect: () => { openBody(bodyA.name, bodyA.side, bodyA.rowId) },
  })
  if (bodyB !== undefined) secondary.push({
    id: 'body-b', label: 'B · ' + bodyB.name, attributes: { 'data-role': 'body-b' },
    onSelect: () => { openBody(bodyB.name, bodyB.side, bodyB.rowId) },
  })
  for (const action of row.actions) {
    if (action.id === 'approve' || action.id === 'reject' || action.id === 'copy' || action.id === 'discard') continue
    secondary.push({
      id: action.id,
      label: t('action.' + action.id),
      disabled: !action.enabled || busy,
      attributes: { 'data-role': 'row-action' },
      onSelect: () => { if (action.enabled && !busy) copy(action.command) },
    })
  }
  const facts = [
    ...(row.target === undefined ? [] : [{ label: t('row.target'), value: row.target }]),
    ...(row.failure === undefined ? [] : [{ label: t('row.failure'), value: row.failure.code + (row.failure.retryable ? '' : ' · ' + t('row.noRetry')) }]),
    ...(row.expired === undefined ? [] : [{ label: t('row.expired'), value: t('expired.' + row.expired) }]),
    ...(row.reasonCode === undefined && row.reason === undefined ? [] : [{ label: t('row.reason'), value: reasonText(t, row.reasonCode, row.reason ?? '') }]),
  ]
  const decisionDetails = createElement('div', null,
    stageNode(row, t),
    summaryNode(row, t),
    first === '' ? null : createElement('div', { 'data-role': 'row-facts' }, first),
    createElement('details', { 'data-role': 'row-details' },
      createElement('summary', null, t('row.details')),
      createElement('p', null, details)),
  )
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
    createElement(DecisionFrame, { className: 'merge-decision', decision: {
      title: row.label,
      facts,
      ...(primary === undefined ? {} : { primary }),
      ...(secondary.length === 0 ? {} : { secondary }),
      details: decisionDetails,
    } }),
    createElement('div', { 'data-role': 'row-actions' },
      createElement('div', { 'data-role': 'row-meta' }, new Date(row.updatedAt).toLocaleString()),
      createElement('details', { 'data-role': 'row-more' },
        createElement('summary', null, t('row.more')),
        createElement('button', {
          type: 'button', 'data-role': 'row-sort', 'aria-haspopup': 'menu', title: t('sort.menu'),
          onClick: (event: MouseEvent<HTMLButtonElement>) => {
            const rect = event.currentTarget.getBoundingClientRect()
            sort.menu(row.id, rect.left, rect.bottom)
          },
        }, t('sort.menu')),
        ...row.actions.map(action => createElement('button', {
          key: 'copy-' + action.id, type: 'button', 'data-role': 'row-copy', 'data-action': action.id + '-copy',
          title: action.command, disabled: busy, onClick: () => { if (!busy) copy(action.command) },
        }, t('row.copy') + ' ' + t('action.' + action.id))),
      ),
    ),
  )
}
