/**
 * The "writes awaiting approval" card: the staged write window, with the two decisions on each row.
 *
 * It is a card in the SAME section and wears the SAME shell as the parameter cards (header with title,
 * count and chevron; body of field blocks; a button row per block), so nothing here invents a second
 * visual language. Two things differ on purpose: the data comes from the host's approval routes rather
 * than the settings transport, and its three states are distinct — "reading", "nothing staged" and "the
 * read failed" each say so in their own words (E7: merging the first two is what made an empty panel
 * look like lost data).
 *
 * Every decision re-reads the window instead of predicting the outcome: the host owns the state, and a
 * refusal is shown with the host's own sentence.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client/PendingCard
 */
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ApprovalApi, PendingRow } from './api.ts'
import type { MessageKey } from './messages.ts'
import {
  beginAction, collapsed, endAction, expanded, failed, INITIAL_PENDING_STATE, loaded, loading, noticed, previewArrived,
  type PendingState, type PreviewView,
} from './pending-state.ts'

/** Injected face: the copy seat and the host calls. No hook compartment — this card keeps its own state. */
export interface PendingCardFace {
  t: (key: MessageKey) => string
  api: ApprovalApi
}

/** Which word one age bucket gets; an unknown bucket falls back to the count form. */
const AGE_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
  now: 'approvalAgeNow',
  minutes: 'approvalAgeMinutes',
  hours: 'approvalAgeHours',
  days: 'approvalAgeDays',
  months: 'approvalAgeMonths',
})

/** Which word one staged kind gets. */
const KIND_KEYS: Readonly<Record<PendingRow['kind'], MessageKey>> = Object.freeze({
  memory: 'approvalKindMemory',
  skill: 'approvalKindSkill',
  capability: 'approvalKindCapability',
})

/**
 * Render the pending window.
 * @param props - the copy seat and the host calls.
 * @returns the card.
 */
export function PendingCard(props: PendingCardFace): ReactNode {
  const { t, api } = props
  const [state, setState] = useState<PendingState>(INITIAL_PENDING_STATE)
  const [open, setOpen] = useState(true)
  // The card reads the LATEST state from a holder rather than through an update function: the ambient
  // React surface this package carries has no updater form, and an action's answer arrives after an
  // await, when the render that started it is long gone.
  const latest = useRef(state)
  const apply = (next: (previous: PendingState) => PendingState): void => {
    const value = next(latest.current)
    latest.current = value
    setState(value)
  }

  const load = async (): Promise<void> => {
    apply(loading)
    const answer = await api.pending()
    apply(current => answer.ok ? loaded(current, answer.data) : failed(current, answer.message))
  }

  useEffect(() => {
    void load()
  }, [])

  const decide = (id: string, action: 'approve' | 'reject'): void => {
    apply(current => beginAction(current, id))
    void (async () => {
      const answer = action === 'approve' ? await api.approve(id) : await api.reject(id)
      if (!answer.ok) {
        apply(current => noticed(endAction(current, id), answer.message))
        return
      }
      apply(current => noticed(endAction(current, id), null))
      // The decision landed: re-read rather than removing the row locally, so the list always shows
      // what the host actually holds.
      await load()
    })()
  }

  const age = (row: PendingRow): string => {
    const key = AGE_KEYS[row.age.unit]
    if (key === undefined) return String(row.age.n)
    return t(key).replace('{n}', String(row.age.n))
  }

  /** Ask the host what this record would store; the answer lands only if the row is still open. */
  const loadPreview = async (id: string): Promise<void> => {
    const answer = await api.preview(id)
    const view: PreviewView = answer.ok
      ? answer.data.available ? { kind: 'ready', answer: answer.data } : { kind: 'unavailable', reason: answer.data.reason }
      : { kind: 'failed', message: answer.message }
    apply(current => previewArrived(current, id, view))
  }

  const togglePreview = (id: string): void => {
    if (state.open === id) {
      apply(collapsed)
      return
    }
    apply(current => expanded(current, id))
    void loadPreview(id)
  }

  /** The facts line, then the source view: the same shape the history panel's diff uses. */
  const preview = (view: PreviewView): ReactNode => {
    if (view.kind === 'loading') return createElement('p', { className: 'evolution-param-note' }, t('approvalPreviewReading'))
    if (view.kind === 'failed') return createElement('p', { className: 'evolution-param-error' }, view.message)
    if (view.kind === 'unavailable') return createElement('p', { className: 'evolution-param-error' }, t('approvalPreviewNone') + view.reason)
    const facts: ReactNode[] = [
      createElement('span', { className: 'evolution-param-fact', key: 'added' }, t('approvalDiffAdded').replace('{n}', String(view.answer.linesAdded))),
      createElement('span', { className: 'evolution-param-fact', key: 'removed' }, t('approvalDiffRemoved').replace('{n}', String(view.answer.linesRemoved))),
      ...view.answer.truncated ? [createElement('span', { className: 'evolution-param-fact', key: 'cut' }, t('approvalDiffCut'))] : [],
    ]
    const lines: ReactNode[] = []
    for (const hunk of view.answer.hunks) {
      for (const [index, line] of hunk.oldText.split('\n').entries()) {
        if (hunk.oldText === '' && line === '') continue
        lines.push(createElement('div', { key: 'old-' + String(index), className: 'evolution-param-line-del' }, '- ' + line))
      }
      for (const [index, line] of hunk.newText.split('\n').entries()) {
        if (hunk.newText === '' && line === '') continue
        lines.push(createElement('div', { key: 'new-' + String(index), className: 'evolution-param-line-add' }, '+ ' + line))
      }
    }
    return createElement('div', null,
      createElement('p', { className: 'evolution-param-facts' }, ...facts),
      createElement('pre', { className: 'evolution-param-source' }, ...lines.length === 0 ? ['±'] : lines))
  }

  const row = (entry: PendingRow): ReactNode => {
    const busy = state.busy.includes(entry.id)
    const button = (label: MessageKey, action: 'approve' | 'reject'): ReactNode =>
      createElement('button', {
        className: 'evolution-param-button',
        type: 'button',
        disabled: busy,
        onClick: () => { decide(entry.id, action) },
      }, busy ? t('approvalLoading') : t(label))
    return createElement('div', { className: 'evolution-param-field', key: entry.id },
      createElement('div', { className: 'evolution-param-label' },
        createElement('span', { className: 'evolution-param-source' }, t(KIND_KEYS[entry.kind])),
        createElement('span', { className: 'evolution-param-value' }, entry.summary)),
      createElement('p', { className: 'evolution-param-hint' }, age(entry)),
      createElement('div', { className: 'evolution-param-actions' },
        button('approvalApprove', 'approve'),
        button('approvalReject', 'reject'),
        createElement('button', {
          className: 'evolution-param-button',
          type: 'button',
          onClick: () => { togglePreview(entry.id) },
        }, state.open === entry.id ? t('approvalPreviewClose') : t('approvalPreview'))),
      state.open === entry.id && state.preview !== null ? preview(state.preview) : null)
  }

  const body = (): ReactNode => {
    if (state.view.kind === 'loading') return createElement('p', { className: 'evolution-param-note' }, t('approvalLoading'))
    if (state.view.kind === 'empty') return createElement('p', { className: 'evolution-param-note' }, t('approvalEmpty'))
    if (state.view.kind === 'failed') {
      return createElement('div', { className: 'evolution-param-actions' },
        createElement('p', { className: 'evolution-param-error' }, t('approvalFailed') + ': ' + state.view.message),
        createElement('button', { className: 'evolution-param-button', type: 'button', onClick: () => { void load() } }, t('approvalRetry')))
    }
    return createElement('div', null,
      ...state.view.rows.map(row),
      state.notice === null ? null : createElement('p', { className: 'evolution-param-error' }, state.notice))
  }

  const count = state.view.kind === 'ready' ? state.view.rows.length : 0
  return createElement('section', { className: 'evolution-param-card' },
    createElement('button', {
      className: 'evolution-param-head',
      type: 'button',
      onClick: () => { setOpen(!open) },
      'aria-expanded': open,
    },
    createElement('span', { className: 'evolution-param-card-title' }, t('approvalTitle')),
    count === 0 ? null : createElement('span', { className: 'evolution-param-count' }, t('approvalCount').replace('{n}', String(count))),
    createElement('span', { className: 'evolution-param-chevron' }, open ? '▲' : '▼')),
    open ? createElement('div', { className: 'evolution-param-body' }, body()) : null)
}
