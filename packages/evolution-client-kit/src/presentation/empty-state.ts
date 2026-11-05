/** A compact completed/empty state with at most one primary next step. */
import { createElement, type ReactNode } from 'react'
import type { PresentationAction, PresentationTone } from './types.ts'

/** Density/layout hints for the one shared empty state; page CSS owns the actual spacing. */
export type EmptyStateVariant = 'default' | 'compact' | 'centered'

/** Props for the shared empty state. */
export interface EmptyStateProps {
  readonly title: string
  readonly description?: string | undefined
  readonly tone?: PresentationTone | undefined
  readonly primary?: PresentationAction | undefined
  readonly secondary?: PresentationAction | undefined
  readonly className?: string | undefined
  /** Omit for legacy layout; compact/centered are opt-in markers for page-level CSS. */
  readonly variant?: EmptyStateVariant | undefined
}

function actionButton(action: PresentationAction, role: 'primary' | 'secondary'): ReactNode {
  return createElement('button', {
    key: action.id,
    type: 'button',
    'data-role': role === 'primary' ? 'empty-primary' : 'empty-secondary',
    'data-action': action.id,
    ...(action.attributes ?? {}),
    disabled: action.disabled === true || action.busy === true,
    title: action.title ?? action.label,
    onClick: () => { if (action.disabled !== true && action.busy !== true) void action.onSelect() },
  }, action.label)
}

/** Render a quiet empty state; loading/failure remain the caller's separate states. */
export function EmptyState({ title, description, tone = 'neutral', primary, secondary, className, variant = 'default' }: EmptyStateProps): ReactNode {
  const actions = primary === undefined && secondary === undefined ? null : createElement('div', { 'data-role': 'empty-actions' },
    primary === undefined ? null : actionButton(primary, 'primary'),
    secondary === undefined ? null : actionButton(secondary, 'secondary'))
  return createElement('section', {
    'data-role': 'empty-state',
    'data-tone': tone,
    ...(variant === 'default' ? {} : { 'data-variant': variant }),
    ...(className === undefined ? {} : { className }),
  },
  createElement('h2', { 'data-role': 'empty-title' }, title),
  description === undefined || description === '' ? null : createElement('p', { 'data-role': 'empty-description' }, description),
  actions)
}
