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
 * @module @deepseek-ai/dsh-evolution-settings-ui/client/DiagnosticsCard
 */
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DiagnosticRow, DiagnosticsView } from './contracts.generated.ts'
import type { DiagnosticsApi, DiagnosticsState } from './diagnostics-state.ts'
import type { FallbackHint } from './contracts.generated.ts'
import type { MessageKey } from './messages.ts'
import { FailureBlock } from './states.generated.ts'

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
  // Collapsible like every other card in the section (same head geometry, same chevron); it starts
  // open because its summary IS the reading the reader opened the section for.
  const [open, setOpen] = useState(true)
  // A read ticket: a slow answer that arrives after the reader refreshed is dropped, never rendered
  // over a newer one (the same rule the pending card's preview follows).
  const ticket = useRef(0)
  const read = (keepView: boolean): void => {
    const current = ticket.current + 1
    ticket.current = current
    if (!keepView) setState({ phase: 'loading' })
    void api.view().then((answer) => {
      if (ticket.current !== current) return
      setState(answer.ok ? { phase: 'ready', view: answer.data } : { phase: 'failed', failure: answer.failure })
    })
  }
  useEffect(() => {
    read(false)
    // The read runs once per mount: diagnostics change slowly and a focus-triggered refetch would
    // flicker the card (W7 §3).
  }, [])
  const refresh = (): void => { read(true) }
  const summary = state.phase === 'ready' ? summaryOf(state.view.runtime) : undefined
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
  createElement('span', { className: 'evolution-param-chevron' }, open ? '▲' : '▼'),
  )
  const runtime = (view: DiagnosticsView): ReactNode => view.runtime.length === 0 ? null : createElement('div', {},
    createElement('h3', { className: 'evolution-param-group' }, t('diagRuntimeTitle')),
    createElement('div', { className: 'evo-diag-list' }, ...view.runtime.map(row => createElement('div', {
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
    ))),
  )
  const body = (): ReactNode => {
    if (state.phase === 'loading') return createElement('p', { className: 'evolution-param-loading' }, t('stateLoading'))
    if (state.phase === 'failed') return FailureBlock({ failure: state.failure, t: translate, fallback: props.fallback })
    const view: DiagnosticsView = state.view
    return createElement('div', {},
      createElement('p', { className: 'evolution-param-note' }, t('diagSubtitle')),
      createElement('div', { className: 'evolution-param-actions' },
        createElement('button', { type: 'button', className: 'evolution-param-button', onClick: refresh, 'data-action': 'diag-refresh' }, t('diagRefresh')),
      ),
      runtime(view),
      view.runtime.length === 0 ? createElement('p', { className: 'evolution-param-note' }, t('diagNoRows')) : null,
    )
  }
  return createElement('section', { className: 'evolution-param-card', 'data-card': 'diagnostics' }, header,
    open ? createElement('div', { className: 'evolution-param-body' }, body()) : null)
}
