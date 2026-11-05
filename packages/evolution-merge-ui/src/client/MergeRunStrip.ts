/** The merge run strips: active/last identity, state, progress, report and details. */
import { createElement, type ReactNode } from 'react'
import { formatLocalDateTime } from '@lmzhen/dsh-evolution-client-kit'
import type { MergeRunView, MergeViewPayload } from './api.ts'

type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string

/**
 * Render active and last runs as two independently labelled strips.
 * @param props - view, translator and command copier.
 * @returns the strips, or null when neither run exists.
 */
export function MergeRunStrips({ view, t, copy }: { view: MergeViewPayload; t: Translate; copy: (command: string) => void }): ReactNode {
  const active = view.activeRun
  const last = view.lastRun
  if (active === undefined && last === undefined) return null
  return createElement('div', { 'data-role': 'run-strips' },
    active === undefined ? null : runStrip(active, t, copy, 'active'),
    last === undefined ? null : runStrip(last, t, copy, 'last'))
}

function runStrip(run: MergeRunView, t: Translate, copy: (command: string) => void, role: 'active' | 'last'): ReactNode {
  const report = run.actions.find(action => action.id === 'report')
  const reportEnabled = report?.enabled === true
  const internals = [
    createElement('span', { key: 'id', 'data-role': 'run-id', title: run.id }, t('run.id') + ' ' + run.id),
    run.stage === undefined ? null : createElement('span', { key: 'stage', 'data-role': 'run-stage' }, t('stage.' + run.stage)),
    run.endedAt === undefined ? null : createElement('span', { key: 'ended', 'data-role': 'run-ended' }, t('run.endedAt') + ' ' + (formatLocalDateTime(run.endedAt) ?? '')),
    run.failure === undefined ? null : createElement('span', { key: 'failure', 'data-role': 'run-failure', title: run.failure.detail }, t('run.failure') + ' ' + run.failure.code),
    run.currentPairKey === undefined ? null : createElement('span', { key: 'pair', 'data-role': 'run-current-pair' }, t('run.currentPair') + ' ' + run.currentPairKey),
    run.parentRunId === undefined ? null : createElement('span', { key: 'parent', 'data-role': 'run-parent' }, t('run.parent') + ' ' + run.parentRunId),
    run.resultRef === undefined ? null : createElement('span', { key: 'ref', 'data-role': 'run-result-ref', title: run.resultRef }, t('run.resultRef')),
  ]
  return createElement('div', { 'data-role': 'run-strip', 'data-run-role': role, 'data-run-state': run.state },
    createElement('span', { 'data-role': 'run-identity' }, t(role === 'active' ? 'run.current' : 'run.last')),
    createElement('span', { 'data-role': 'run-state' }, t('run.state') + ' ' + t('run.' + run.state)),
    run.progress === null || run.progress === undefined
      ? run.state === 'succeeded' ? createElement('span', { 'data-role': 'run-progress', 'data-progress': 'unknown' }, t('run.progressUnknown')) : null
      : createElement('span', { 'data-role': 'run-progress' }, t('run.progress') + ' ' + String(run.progress.done) + '/' + String(run.progress.total)),
    createElement('button', { type: 'button', 'data-role': 'run-report', 'data-action': 'report', disabled: !reportEnabled, title: reportEnabled ? (report?.command ?? t('run.report')) : t('run.noReport'), onClick: () => { if (reportEnabled && report !== undefined) copy(report.command) } }, t('run.report')),
    ...run.actions.filter(action => action.id !== 'report').map(action => createElement('button', {
      key: action.id, type: 'button', 'data-role': 'run-action', 'data-action': action.id, disabled: !action.enabled,
      title: action.disabledReason === undefined ? action.command : t('disabled.' + action.disabledReason),
      onClick: () => { if (action.enabled) copy(action.command) },
    }, t('action.' + action.id))),
    createElement('details', { 'data-role': 'run-details' },
      createElement('summary', null, t('run.details')),
      ...internals),
  )
}
