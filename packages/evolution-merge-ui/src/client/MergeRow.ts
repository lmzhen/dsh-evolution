/** One merge row: summary, stage, facts, primary decisions and the copy drawer. */
import { createElement, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
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
 * Render one row. Primary decisions stay visible; copy commands live in one details drawer.
 * @param props - row, translator, copier, sort hooks, body opener and decision callback.
 * @returns the row element.
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
  const actions = row.actions.map(action => {
    const decision = (action.id === 'approve' || action.id === 'reject') && onDecide !== undefined
    return createElement('button', {
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
      createElement('details', { 'data-role': 'row-more' },
        createElement('summary', null, t('row.more')),
        ...row.actions.map(action => createElement('button', {
          key: 'copy-' + action.id, type: 'button', 'data-role': 'row-copy', 'data-action': action.id + '-copy',
          title: action.command, disabled: busy, onClick: () => { if (!busy) copy(action.command) },
        }, t('row.copy') + ' ' + t('action.' + action.id))),
      ),
    ),
  )
}
