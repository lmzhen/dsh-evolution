/** A native details group for normal/secondary facts. */
import { createElement, type ReactNode } from 'react'

/** Props for the shared disclosure group. */
export interface DisclosureGroupProps {
  readonly summary: string
  readonly count?: number | undefined
  readonly children: ReactNode
  readonly defaultOpen?: boolean | undefined
  readonly className?: string | undefined
}

/** Render a closed-by-default disclosure without introducing another accordion model. */
export function DisclosureGroup({ summary, count, children, defaultOpen = false, className }: DisclosureGroupProps): ReactNode {
  return createElement('details', {
    'data-role': 'disclosure-group',
    ...(defaultOpen ? { open: true } : {}),
    ...(className === undefined ? {} : { className }),
  },
  createElement('summary', { 'data-role': 'disclosure-summary' },
    createElement('span', { 'data-role': 'disclosure-title' }, summary),
    count === undefined ? null : createElement('span', { 'data-role': 'disclosure-count' }, String(count))),
  createElement('div', { 'data-role': 'disclosure-content' }, children))
}
