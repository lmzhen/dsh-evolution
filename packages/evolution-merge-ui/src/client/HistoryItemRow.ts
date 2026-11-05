/** Structured rows for the read-only merge archive; the modal owns focus and scrolling. */
import { createElement, type ReactNode } from 'react'
import { formatLocalDateTime } from '@lmzhen/dsh-evolution-client-kit'
import type { MergeHistoryItem } from './api.ts'

type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string

function reasonText(t: Translate, item: MergeHistoryItem): string {
  if (item.reasonCode !== undefined) {
    const key = 'history.reason.' + item.reasonCode
    const text = t(key)
    if (text !== key) return text
  }
  return item.reason
}

/** One archive entry: identity and outcome, version/time, then source or reason. */
export function HistoryItemRow({ item, t }: { item: MergeHistoryItem; t: Translate }): ReactNode {
  const kind = t('history.kind.' + item.kind)
  const reason = reasonText(t, item)
  const archived = item.archivedAt === null
    ? t('history.archivedAtUnknown')
    : t('history.archivedAt', { date: formatLocalDateTime(item.archivedAt) ?? t('history.archivedAtUnknown') })
  return createElement('li', { 'data-role': 'history-item' },
    createElement('div', { 'data-role': 'history-item-head' },
      createElement('span', { 'data-role': 'history-item-name' }, item.name),
      createElement('span', { 'data-role': 'history-item-kind', 'data-kind': item.kind }, kind)),
    createElement('div', { 'data-role': 'history-item-meta' },
      createElement('span', { 'data-role': 'history-item-version' }, 'v' + String(item.lastVersion)),
      createElement('span', { 'data-role': 'history-item-archived' }, archived)),
    item.sourceRunId === undefined ? null : createElement('p', { 'data-role': 'history-item-source' },
      t('history.sourceRunId') + ' ' + item.sourceRunId),
    reason === '' || reason === kind ? null : createElement('p', { 'data-role': 'history-item-reason' }, reason),
  )
}
