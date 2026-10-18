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
import type { FallbackHint } from './contracts.generated.ts'
import { FailureBlock, failureText } from './states.generated.ts'
import type { ApprovalApi, PendingRow } from './api.ts'
import type { MessageKey } from './messages.ts'
import {
  beginAction, collapsed, endAction, expanded, failed, INITIAL_PENDING_STATE, loaded, loading, noticed, previewArrived,
  type PendingState, type PreviewView,
} from './pending-state.ts'

/** Injected face: the copy seat and the host calls. No hook compartment — this card keeps its own state. */
export interface PendingCardFace {
  t: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string
  api: ApprovalApi
  /**
   * U-6 (registry `approvalConfirm`): read PER RENDER, like the entry's own seat probe — a value
   * captured once would pin the gate for the life of the fiber. Absent ⇒ the shipped default `auto`.
   */
  confirmMode?: () => 'auto' | 'ask' | 'timeout'
  /** G5/W7 S4: the command-face fallback rendered with an unreachable/unauthenticated failure. */
  fallback?: FallbackHint | undefined
}


/**
 * U-6: the registry's gate word, read out of a section's user layer. ONE definition, exported so the
 * mapping itself is judgeable: the entry does the wiring, this does the reading. Anything that is not
 * one of the two explicit words falls back to the shipped default (`auto`) — a document written by a
 * future version must not silently turn the confirmation ON, and a typo must not turn it off. The
 * independent review flagged that this reader had no case at all (P2-11).
 */
export function confirmModeFrom(user: unknown): 'auto' | 'ask' | 'timeout' {
  const value = typeof user === 'object' && user !== null ? (user as Record<string, unknown>).approvalConfirm : undefined
  return value === 'ask' || value === 'timeout' ? value : 'auto'
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
  // The shared failure renderer speaks key-STRING; this card's keys stay typed at this one boundary.
  const translate = (key: string, values?: Readonly<Record<string, string | number>>): string => t(key as MessageKey, values as never)
  // U-6: which entry is ARMED for a second click. `auto` (the default) never arms: an approval batch
  // must not be interrupted by a confirmation nobody asked for (31 号 §U-6 的风险行).
  const confirmMode = props.confirmMode?.() ?? 'auto'
  const [armed, setArmed] = useState<string | null>(null)
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

  /**
   * Read the window the card is about: the writes WAITING and the writes RUNNING.
   *
   * T4-05/A47: the route has always taken `?status=` — the CLI asks for both lists — but this card
   * asked for neither, so a record whose approve died between the claim and the decision showed as
   * "nothing is waiting for a decision" while `/evolution pending` and doctor listed it. The two
   * answers are ordered the way the CLI orders them (waiting first); either one failing fails the
   * read, because a half-list would read as a complete window.
   */
  // G4/4.1 (second half): the read ticket skill-history/Panel.ts already uses for the same hazard.
  // Without it a slow read that lands after a newer one writes its stale window over the fresh one
  // (measured: the focused re-read resolved first, then the mount read landed and replaced the rows).
  const readTicket = useRef(0)

  const load = async (): Promise<void> => {
    apply(loading)
    const ticket = readTicket.current + 1
    readTicket.current = ticket
    const [waiting, running] = await Promise.all([api.pending(), api.pending('executing')])
    // Only the newest read may write state: an older answer is a fact about a window that has
    // already been replaced.
    if (readTicket.current !== ticket) return
    if (!waiting.ok) {
      apply(current => failed(current, waiting.failure))
      return
    }
    if (!running.ok) {
      apply(current => failed(current, running.failure))
      return
    }
    apply(current => loaded(current, [...waiting.data, ...running.data]))
  }

  useEffect(() => {
    void load()
    // T5-04/A59: the window is owned by the host and changes WHILE this card is mounted (an agent
    // stages a write mid-session). Reading exactly once left the empty sentence standing after a
    // write had been staged — "nothing is waiting" when something was — and the only way out was
    // leaving the partition. Deliberately not a timer (the family has no polling precedent): a
    // window focus re-read, plus the explicit refresh control in the header.
    const onFocus = (): void => { void load() }
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, [])

  const decide = (id: string, action: 'approve' | 'reject'): void => {
    apply(current => beginAction(current, id))
    void (async () => {
      const answer = action === 'approve' ? await api.approve(id) : await api.reject(id)
      if (!answer.ok) {
        apply(current => noticed(endAction(current, id), failureText(answer.failure, translate)))
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
    return t(key, { n: row.age.n })
  }

  /** Ask the host what this record would store; the answer lands only if the row is still open. */
  const loadPreview = async (id: string): Promise<void> => {
    const answer = await api.preview(id)
    const view: PreviewView = answer.ok
      ? answer.data.available ? { kind: 'ready', answer: answer.data } : { kind: 'unavailable', reason: answer.data.reason }
      : { kind: 'failed', failure: answer.failure }
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
    if (view.kind === 'loading') return createElement('p', { className: 'evolution-param-note', role: 'status' }, t('approvalPreviewReading'))
    if (view.kind === 'failed') return createElement('p', { className: 'evolution-param-error', role: 'status' }, failureText(view.failure, translate))
    if (view.kind === 'unavailable') return createElement('p', { className: 'evolution-param-error', role: 'status' }, t('approvalPreviewNone') + view.reason)
    const facts: ReactNode[] = [
      createElement('span', { className: 'evolution-param-fact', key: 'added' }, t('approvalDiffAdded', { n: view.answer.linesAdded })),
      createElement('span', { className: 'evolution-param-fact', key: 'removed' }, t('approvalDiffRemoved', { n: view.answer.linesRemoved })),
      ...view.answer.truncated ? [createElement('span', { className: 'evolution-param-fact', key: 'cut' }, t('approvalDiffCut'))] : [],
    ]
    const lines: ReactNode[] = []
    // C-11: the row key is scoped to its HUNK, exactly as document.ts does it. A per-hunk index
    // restarts at 0, so with two hunks the second old-0 collided with the first and React reused
    // the wrong node (a line of one hunk shown in place of another). The data source returns at
    // most one hunk today, so this is a consistency debt being paid before it can bite.
    for (const [hunkIndex, hunk] of view.answer.hunks.entries()) {
      for (const [index, line] of hunk.oldText.split('\n').entries()) {
        if (hunk.oldText === '' && line === '') continue
        lines.push(createElement('div', { key: 'old-' + String(hunkIndex) + '-' + String(index), className: 'evolution-param-line-del' }, '- ' + line))
      }
      for (const [index, line] of hunk.newText.split('\n').entries()) {
        if (hunk.newText === '' && line === '') continue
        lines.push(createElement('div', { key: 'new-' + String(hunkIndex) + '-' + String(index), className: 'evolution-param-line-add' }, '+ ' + line))
      }
    }
    return createElement('div', null,
      createElement('p', { className: 'evolution-param-facts' }, ...facts),
      // T5-02/A57: `.evolution-param-source` was TWO rules (the row's chip and this diff block) under
      // one selector in one stylesheet, so the later rule won every shared property: the chip grew a
      // 12/16px padding inside a 20px box, and these diff lines became flex items laid out in a ROW.
      createElement('pre', { className: 'evolution-param-diff' }, ...lines.length === 0 ? ['±'] : lines))
  }

  const row = (entry: PendingRow): ReactNode => {
    // T4-05/A47: a running record is NOT waiting for a decision — its write effect may already have
    // landed — so the two decisions are absent and the row says what to do instead (the CLI's own
    // instruction). Offering "approve" here is the double-approve the CLI warns about.
    if (entry.status === 'executing') {
      return createElement('div', { className: 'evolution-param-field', key: entry.id },
        createElement('div', { className: 'evolution-param-label' },
          createElement('span', { className: 'evolution-param-source' }, t(KIND_KEYS[entry.kind])),
          createElement('span', { className: 'evolution-param-value' }, entry.summary)),
        createElement('p', { className: 'evolution-param-hint' }, age(entry)),
        createElement('p', { className: 'evolution-param-note', role: 'status' }, t('approvalExecuting')),
        entry.claimedBy === undefined ? null : createElement('p', { className: 'evolution-param-hint' }, entry.claimedBy))
    }
    const busy = state.busy.includes(entry.id)
    // U-6: the weight of the action is part of the decision. Approve is the destructive one (it
    // replays a staged write) and carries the family's existing primary convention; reject is an
    // outlined alternative; preview merely reveals and stays weightless.
    const button = (label: MessageKey, action: 'approve' | 'reject', tone: 'primary' | 'outline'): ReactNode =>
      createElement('button', {
        className: 'evolution-param-button',
        type: 'button',
        disabled: busy,
        ...(tone === 'primary' ? { 'data-primary': 'true' } : { 'data-tone': tone }),
        onClick: () => {
          // The gate sits on the destructive side only, and only when the registry says `ask`.
          if (action === 'approve' && confirmMode === 'ask' && armed !== entry.id) {
            setArmed(entry.id)
            return
          }
          setArmed(null)
          decide(entry.id, action)
        },
      }, busy ? t('approvalLoading') : t(label))
    return createElement('div', { className: 'evolution-param-field', key: entry.id },
      createElement('div', { className: 'evolution-param-label' },
        createElement('span', { className: 'evolution-param-source' }, t(KIND_KEYS[entry.kind])),
        createElement('span', { className: 'evolution-param-value' }, entry.summary)),
      createElement('p', { className: 'evolution-param-hint' }, age(entry)),
      armed === entry.id
        ? createElement('p', { className: 'evolution-param-note', role: 'status' },
          // The sentence gets its OWN element: a bare text child shares the paragraph with the two
          // buttons, and an assertion on it then has to fight the query's own-text rule (U-6 fixture).
          createElement('span', { className: 'evolution-param-value' }, t('approvalConfirmNamed', { n: entry.summary })),
          createElement('button', {
            className: 'evolution-param-button',
            type: 'button',
            // A marker of its own, because its label is the same word as the row's approve button:
            // an assertion that goes by text alone would find two elements (U-6 fixture).
            'data-confirm': 'yes',
            'data-primary': 'true',
            onClick: () => { setArmed(null); decide(entry.id, 'approve') },
          }, t('approvalConfirmYes')),
          createElement('button', {
            className: 'evolution-param-button',
            type: 'button',
            'data-tone': 'ghost',
            onClick: () => { setArmed(null) },
          }, t('approvalConfirmNo')))
        : null,
      createElement('div', { className: 'evolution-param-actions' },
        button('approvalApprove', 'approve', 'primary'),
        button('approvalReject', 'reject', 'outline'),
        createElement('button', {
          className: 'evolution-param-button',
          type: 'button',
          'data-tone': 'ghost',
          onClick: () => { togglePreview(entry.id) },
        }, state.open === entry.id ? t('approvalPreviewClose') : t('approvalPreview'))),
      state.open === entry.id && state.preview !== null ? preview(state.preview) : null)
  }

  const body = (): ReactNode => {
    if (state.view.kind === 'loading') return createElement('p', { className: 'evolution-param-note', role: 'status' }, t('approvalLoading'))
    if (state.view.kind === 'empty') return createElement('p', { className: 'evolution-param-note', role: 'status' }, t('approvalEmpty'))
    if (state.view.kind === 'failed') {
      // G5/W7 S4: the shared four-state failure block (401/403/404 sentence + command fallback when the
      // data plane is absent), then the card's own retry control.
      return createElement('div', { className: 'evolution-param-actions' },
        FailureBlock({ failure: state.view.failure, t: translate, fallback: props.fallback }),
        createElement('button', { className: 'evolution-param-button', type: 'button', onClick: () => { void load() } }, t('approvalRetry')))
    }
    return createElement('div', null,
      ...state.view.rows.map(row),
      state.notice === null ? null : createElement('p', { className: 'evolution-param-error', role: 'status' }, state.notice))
  }

  // The two windows are counted apart: a running record is not "waiting", and one number over both
  // would tell the reader the wrong thing about each.
  const rows = state.view.kind === 'ready' ? state.view.rows : []
  const waiting = rows.filter(entry => entry.status !== 'executing').length
  const running = rows.length - waiting
  return createElement('section', { className: 'evolution-param-card' },
    createElement('button', {
      className: 'evolution-param-head',
      type: 'button',
      onClick: () => { setOpen(!open) },
      'aria-expanded': open,
    },
    createElement('span', { className: 'evolution-param-card-title' }, t('approvalTitle')),
    waiting === 0 ? null : createElement('span', { className: 'evolution-param-count' }, t('approvalCount', { n: waiting })),
    running === 0 ? null : createElement('span', { className: 'evolution-param-count' }, t('approvalRunningCount', { n: running })),
    createElement('span', { className: 'evolution-param-chevron' }, open ? '▲' : '▼')),
    open
      ? createElement('div', { className: 'evolution-param-body' },
        // T5-04/A59: the explicit re-read. The reader who staged a write from the session can pull
        // the window without leaving the partition.
        createElement('div', { className: 'evolution-param-actions' },
          createElement('button', {
            className: 'evolution-param-button',
            type: 'button',
            onClick: () => { void load() },
          }, t('approvalRefresh'))),
        body())
      : null)
}
