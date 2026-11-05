/** A read-only task hint; it deliberately has no primary action. */
import { createElement, type ReactNode } from 'react'

/** Props for the shared task banner. */
export interface TaskBannerProps {
  readonly count: number
  readonly text: string
  readonly className?: string | undefined
}

/**
 * Render a task count plus one sentence. The absence of an action prop is the contract.
 * @param props - count, sentence and optional surface class.
 * @returns the banner.
 */
export function TaskBanner({ count, text, className }: TaskBannerProps): ReactNode {
  return createElement('div', {
    'data-role': 'task-banner',
    'data-count': String(count),
    role: 'status',
    ...(className === undefined ? {} : { className }),
  },
  createElement('strong', { 'data-role': 'task-banner-count' }, String(count)),
  createElement('span', { 'data-role': 'task-banner-text' }, text))
}
