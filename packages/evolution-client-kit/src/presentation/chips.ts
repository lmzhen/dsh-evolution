/** Read-only status chips and toggleable filter chips. */
import { createElement, type ReactNode } from 'react'
import type { PresentationTone } from './types.ts'

/** Props for one non-interactive status chip. */
export interface StatusChipProps {
  readonly label: string
  readonly tone?: PresentationTone | undefined
  readonly className?: string | undefined
}

/** Render one semantic status word. */
export function StatusChip({ label, tone = 'neutral', className }: StatusChipProps): ReactNode {
  return createElement('span', {
    'data-role': 'status-chip',
    'data-tone': tone,
    ...(className === undefined ? {} : { className }),
  }, label)
}

/** Props for a filter chip that only changes the visible list. */
export interface FilterChipProps {
  readonly label: string
  readonly active: boolean
  readonly onClick: () => void
  readonly count?: number | undefined
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}

/** Render a toggleable filter with the pressed state exposed to assistive tech. */
export function FilterChip({ label, active, onClick, count, disabled = false, className }: FilterChipProps): ReactNode {
  return createElement('button', {
    type: 'button',
    'data-role': 'filter-chip',
    'data-active': active ? 'true' : 'false',
    'aria-pressed': active ? 'true' : 'false',
    disabled,
    ...(className === undefined ? {} : { className }),
    onClick: () => { if (!disabled) onClick() },
  },
  createElement('span', { 'data-role': 'filter-chip-label' }, label),
  count === undefined ? null : createElement('span', { 'data-role': 'filter-chip-count' }, String(count)))
}
