/**
 * The diagnostics card (W7 S7): the browser face of the SAME DiagnosticsView the CLI and the
 * `/api/dsh-evolution/diagnostics` route answer.
 *
 * Read-only by construction: it fetches once on mount and only refetches on an explicit Refresh; a
 * failed read renders the shared FailureBlock with the command-face fallback. Facts and runtime rows
 * are rendered in the view's own order — the client owns no key list and no status vocabulary.
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
  const header = createElement('div', { className: 'evolution-param-card-head' },
    createElement('span', { className: 'evolution-param-card-title' }, t('diagTitle')),
    createElement('button', { type: 'button', className: 'evolution-param-button', onClick: refresh, 'data-action': 'diag-refresh' }, state.phase === 'loading' ? t('diagRefreshing') : t('diagRefresh')),
  )
  const body = (): ReactNode => {
    if (state.phase === 'loading') return createElement('p', { className: 'evolution-param-loading' }, t('stateLoading'))
    if (state.phase === 'failed') return FailureBlock({ failure: state.failure, t: translate, fallback: props.fallback })
    const view: DiagnosticsView = state.view
    const factRows = view.facts.map(fact => createElement('div', { key: 'fact-' + fact.key, className: 'evo-diag-row', 'data-kind': 'fact' },
      createElement('span', { className: 'evo-diag-key' }, fact.label),
      createElement('span', { className: 'evo-diag-value' }, fact.value),
      createElement('span', { className: 'evo-diag-home' }, t('diagHomeCite', { home: fact.home })),
    ))
    const runtimeRows = view.runtime.map(row => createElement('div', { key: 'runtime-' + row.key, className: 'evo-diag-row', 'data-kind': 'runtime', 'data-status': row.status },
      createElement('span', { className: 'evo-diag-key' }, row.label),
      createElement('span', { className: 'evo-diag-status' }, t(STATUS_KEYS[row.status])),
      row.detail === undefined ? null : createElement('span', { className: 'evo-diag-detail' }, row.detail),
      row.remedy === undefined ? null : createElement('span', { className: 'evo-diag-remedy' }, t('diagRemedy') + row.remedy),
    ))
    return createElement('div', { className: 'evo-diag-body' },
      createElement('p', { className: 'evolution-params-subtitle' }, t('diagSubtitle')),
      createElement('p', { className: 'evo-diag-meta' }, t('diagSchema', { n: view.schemaVersion }) + ' · ' + t('diagGeneratedAt', { at: view.generatedAt })),
      createElement('h3', { className: 'evo-diag-section' }, t('diagFactsTitle')),
      ...factRows,
      createElement('h3', { className: 'evo-diag-section' }, t('diagRuntimeTitle')),
      ...runtimeRows,
    )
  }
  return createElement('div', { className: 'evolution-param-card', 'data-card': 'diagnostics' }, header, body())
}
