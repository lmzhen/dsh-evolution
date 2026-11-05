/** One decision card: title, facts, at most one primary, secondary actions and details. */
import { createElement, type ReactNode } from 'react'
import type { DecisionModel, PresentationAction } from './types.ts'

/** Props for the shared decision frame. */
export interface DecisionFrameProps {
  readonly decision: DecisionModel
  readonly className?: string | undefined
}

function actionButton(action: PresentationAction, role: 'primary' | 'secondary'): ReactNode {
  return createElement('button', {
    key: action.id,
    type: 'button',
    'data-role': role === 'primary' ? 'decision-primary' : 'decision-secondary',
    'data-action': action.id,
    'aria-busy': action.busy === true ? 'true' : undefined,
    disabled: action.disabled === true || action.busy === true,
    title: action.title ?? action.label,
    onClick: () => { if (action.disabled !== true && action.busy !== true) void action.onSelect() },
  }, action.label)
}

/**
 * Render the one-card decision surface. The model has a singular primary on purpose.
 * @param props - decision model and optional surface class.
 * @returns the decision frame.
 */
export function DecisionFrame({ decision, className }: DecisionFrameProps): ReactNode {
  const secondary = decision.secondary ?? []
  return createElement('section', {
    'data-role': 'decision-frame',
    ...(className === undefined ? {} : { className }),
  },
  createElement('h2', { 'data-role': 'decision-title' }, decision.title),
  decision.summary === undefined || decision.summary === '' ? null : createElement('p', { 'data-role': 'decision-summary' }, decision.summary),
  decision.facts.length === 0 ? null : createElement('dl', { 'data-role': 'decision-facts' },
    decision.facts.map(fact => createElement('div', { key: fact.label, 'data-role': 'decision-fact' },
      createElement('dt', null, fact.label),
      createElement('dd', null, fact.value))),
  ),
  decision.details === undefined ? null : createElement('div', { 'data-role': 'decision-details' }, decision.details),
  decision.primary === undefined && secondary.length === 0 ? null : createElement('div', { 'data-role': 'decision-actions' },
    decision.primary === undefined ? null : actionButton(decision.primary, 'primary'),
    secondary.map(action => actionButton(action, 'secondary')),
  ))
}
