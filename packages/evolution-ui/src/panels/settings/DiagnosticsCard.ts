/**
 * The diagnostics card (W7 S7): the settings face of the SAME DiagnosticsView the CLI and the
 * `/api/dsh-evolution/diagnostics` route answer.
 *
 * Read-only by construction: it fetches once on mount and only refetches on an explicit Refresh; a
 * failed read renders the shared FailureBlock with the command-face fallback. The client owns no
 * key list and no status vocabulary: it renders the host view's frozen runtime rows and leads with
 * a plain-language summary. The view's documentation facts are a CLI/JSON concern and are
 * deliberately NOT rendered here (0.27.2 real-machine feedback: a settings page is not a spec
 * sheet; the runtime window is the whole reading).
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client/DiagnosticsCard
 */
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DiagnosticRow, DiagnosticsView } from '@lmzhen/dsh-evolution-client-kit/generated/contracts'
import type { DiagnosticsApi, DiagnosticsState } from './diagnostics-state.ts'
import type { FallbackHint } from '@lmzhen/dsh-evolution-client-kit/generated/contracts'
import type { MessageKey } from './messages.ts'
import { FailureBlock } from '@lmzhen/dsh-evolution-client-kit/generated/states'

/** Injected face: the copy seat, the one host call, and this surface's command fallback. */
export interface DiagnosticsCardFace {
  t: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string
  api: DiagnosticsApi
  fallback?: FallbackHint | undefined
}

/** Which word one status gets (the frozen W1 status set). */
const STATUS_KEYS: Readonly<Record<DiagnosticRow['status'], MessageKey>> = Object.freeze({
  ok: 'diagStatusOk',
  warn: 'diagStatusWarn',
  fail: 'diagStatusFail',
  unknown: 'diagStatusUnknown',
})

/** The summary word for a badge status (the same frozen set; ok has no count). */
const SUMMARY_KEYS: Readonly<Record<DiagnosticRow['status'], MessageKey>> = Object.freeze({
  ok: 'diagSummaryOk',
  warn: 'diagSummaryWarn',
  fail: 'diagSummaryFail',
  unknown: 'diagSummaryUnknown',
})

/** A reading split: top issue, remaining issues and the folded normal checks. */
export interface DiagnosticsReading {
  readonly topIssue: DiagnosticRow | undefined
  readonly otherIssues: readonly DiagnosticRow[]
  readonly normal: readonly DiagnosticRow[]
}

/**
 * Split the frozen runtime rows without dropping one. The top issue follows the same fail > warn > unknown order.
 * @param rows - runtime rows from the host view.
 * @returns the reading shape used by the card.
 */
export function diagnosticsReading(rows: readonly DiagnosticRow[]): DiagnosticsReading {
  const order: readonly DiagnosticRow['status'][] = ['fail', 'warn', 'unknown']
  const issues = [...rows].filter(row => row.status !== 'ok').sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
  return { topIssue: issues[0], otherIssues: issues.slice(1), normal: rows.filter(row => row.status === 'ok') }
}

/** The one status the card leads with: fail > warn > unknown > ok. */
function summaryOf(rows: readonly DiagnosticRow[]): { status: DiagnosticRow['status']; count: number } {
  const count = (status: DiagnosticRow['status']): number => rows.filter(row => row.status === status).length
  for (const status of ['fail', 'warn', 'unknown'] as const) {
    const n = count(status)
    if (n > 0) return { status, count: n }
  }
  return { status: 'ok', count: 0 }
}


/**
 * Render the card.
 * @param props - the copy seat, the host call and the command fallback.
 * @returns the card.
 */
export function DiagnosticsCard(props: DiagnosticsCardFace): ReactNode {
  const { t, api } = props
  // states.generated's Translate is deliberately key-STRING (it renders keys the card owns); this
  // card's own copy keys stay typed, so the two meet at this one boundary.
  const translate = (key: string, values?: Readonly<Record<string, string | number>>): string => t(key as MessageKey, values)
  const [state, setState] = useState<DiagnosticsState>({ phase: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [copyNotice, setCopyNotice] = useState('')
  const [refreshFailure, setRefreshFailure] = useState<import('@lmzhen/dsh-evolution-client-kit/generated/route-client').RouteFailure | undefined>(undefined)
  // Collapsible like every other card in the section (same head geometry, same chevron); it starts
  // closed so a diagnostic read never dominates the section before the operator asks for it.
  const [open, setOpen] = useState(false)
  // A read ticket: a slow answer that arrives after the reader refreshed is dropped, never rendered
  // over a newer one (the same rule the pending card's preview follows).
  const ticket = useRef(0)
  const read = (keepView: boolean): void => {
    const current = ticket.current + 1
    ticket.current = current
    if (keepView) { setRefreshing(true); setRefreshFailure(undefined) }
    else setState({ phase: 'loading' })
    void api.view().then((answer) => {
      if (ticket.current !== current) return
      if (answer.ok) { setState({ phase: 'ready', view: answer.data }); setRefreshFailure(undefined) }
      else if (keepView) setRefreshFailure(answer.failure)
      else setState({ phase: 'failed', failure: answer.failure })
    }).finally(() => { if (ticket.current === current) setRefreshing(false) })
  }
  useEffect(() => {
    read(false)
    // The read runs once per mount: diagnostics change slowly and a focus-triggered refetch would
    // flicker the card (W7 §3).
  }, [])
  const refresh = (): void => { read(true) }
  const copyRemedy = (command: string): void => {
    setCopyNotice('')
    if (navigator.clipboard?.writeText === undefined) { setCopyNotice(t('diagCopyFailed')); return }
    void navigator.clipboard.writeText(command).then(
      () => { setCopyNotice(t('diagCopied')) },
      () => { setCopyNotice(t('diagCopyFailed')) },
    )
  }
  const summary = state.phase === 'ready' ? summaryOf(state.view.runtime) : undefined
  const focusRow = summary === undefined || summary.status === 'ok' || state.phase !== 'ready'
    ? undefined
    : state.view.runtime.find(row => row.status === summary.status)
  const header = createElement('button', {
    type: 'button',
    className: 'evolution-param-head',
    'aria-expanded': open ? 'true' : 'false',
    onClick: () => { setOpen(!open) },
  },
  createElement('span', { className: 'evolution-param-card-title' }, t('diagTitle')),
  summary === undefined ? null : createElement('span', {
    className: 'evo-diag-badge',
    'data-status': summary.status,
  }, t(SUMMARY_KEYS[summary.status], summary.count === 0 ? undefined : { n: summary.count })),
  focusRow === undefined ? null : createElement('span', { 'data-role': 'diag-focus' }, focusRow.label),
  createElement('span', { className: 'evolution-param-chevron' }, open ? '▲' : '▼'),
  )
  const runtime = (view: DiagnosticsView): ReactNode => {
    if (view.runtime.length === 0) return null
    const reading = diagnosticsReading(view.runtime)
    const rowNode = (row: DiagnosticRow): ReactNode => createElement('div', {
      key: 'runtime-' + row.key,
      className: 'evo-diag-item',
      'data-kind': 'runtime',
      'data-status': row.status,
    },
    createElement('div', { className: 'evo-diag-row-head' },
      createElement('span', { className: 'evo-diag-dot' }),
      createElement('span', { className: 'evo-diag-label' }, row.label),
      createElement('span', { className: 'evo-diag-status' }, t(STATUS_KEYS[row.status])),
    ),
    row.detail === undefined ? null : createElement('span', { className: 'evo-diag-detail' }, row.detail),
    row.remedy === undefined ? null : createElement('span', { className: 'evo-diag-remedy' }, t('diagRemedy') + row.remedy),
    )
    return createElement('div', {},
      createElement('h3', { className: 'evolution-param-group' }, t('diagRuntimeTitle')),
      reading.topIssue === undefined
        ? createElement('div', { className: 'evo-diag-complete', 'data-role': 'diag-complete' }, t('diagComplete'))
        : createElement('div', { className: 'evo-diag-issue', 'data-role': 'diag-issue', 'data-status': reading.topIssue.status },
          rowNode(reading.topIssue),
          createElement('div', { className: 'evo-diag-issue-actions', 'data-role': 'diag-issue-actions' },
            reading.topIssue.remedy?.startsWith('/') === true
              ? createElement('button', { type: 'button', className: 'evolution-param-button', 'data-action': 'diag-copy-remedy', onClick: () => { copyRemedy(reading.topIssue!.remedy!) } }, t('diagCopyRemedy'))
              : null,
            createElement('button', { type: 'button', className: 'evolution-param-button', 'data-action': 'diag-recheck', disabled: refreshing, onClick: refresh }, t('diagRecheck')),
          ),
          copyNotice === '' ? null : createElement('p', { className: 'evolution-param-note', role: 'status', 'data-role': 'diag-copy-status' }, copyNotice)),
      reading.otherIssues.length === 0 ? null : createElement('details', { className: 'evo-diag-group', 'data-role': 'diag-other-issues' },
        createElement('summary', null, t('diagOtherIssues', { n: reading.otherIssues.length })),
        ...reading.otherIssues.map(rowNode)),
      reading.normal.length === 0 ? null : createElement('details', { className: 'evo-diag-group', 'data-role': 'diag-normal' },
        createElement('summary', null, t('diagNormal', { n: reading.normal.length })),
        ...reading.normal.map(rowNode)),
    )
  }
  const body = (): ReactNode => {
    if (state.phase === 'loading') return createElement('p', { className: 'evolution-param-loading' }, t('stateLoading'))
    if (state.phase === 'failed') return FailureBlock({ failure: state.failure, t: translate, fallback: props.fallback })
    const view: DiagnosticsView = state.view
    return createElement('div', {},
      createElement('p', { className: 'evolution-param-note' }, t('diagSubtitle')),
      refreshFailure === undefined ? null : FailureBlock({ failure: refreshFailure, t: translate, fallback: props.fallback }),
      createElement('div', { className: 'evolution-param-actions' },
        createElement('button', { type: 'button', className: 'evolution-param-button', onClick: refresh, disabled: refreshing, 'data-action': 'diag-refresh' }, t(refreshing ? 'diagRefreshing' : 'diagRefresh')),
      ),
      runtime(view),
      view.runtime.length === 0 ? createElement('p', { className: 'evolution-param-note' }, t('diagNoRows')) : null,
      createElement('p', { className: 'evolution-param-note', 'data-role': 'diag-purpose' }, t('diagPurpose')),
      createElement('p', { className: 'evolution-param-hint', 'data-role': 'diag-footer' }, t('diagFooter', { version: String(view.schemaVersion), at: new Date(view.generatedAt).toLocaleString() })),
    )
  }
  return createElement('section', { className: 'evolution-param-card', 'data-card': 'diagnostics' }, header,
    open ? createElement('div', { className: 'evolution-param-body' }, body()) : null)
}
