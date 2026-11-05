/** One inline state notice: semantic tone plus text, no surface-specific styling. */
import { createElement, type ReactNode } from 'react'

export type StateNoticeTone = 'info' | 'warning' | 'error'

export interface StateNoticeProps {
  readonly tone: StateNoticeTone
  readonly text: string
  /** Optional count shown after the sentence (e.g. "2 expired"). */
  readonly count?: number | undefined
  readonly className?: string | undefined
}

/**
 * Render one informative/warning/error line. The caller owns the surface class and CSS;
 * this leaf owns only the accessible role and the fact/count split.
 * @param props - tone, text, optional count/class.
 * @returns a semantic state notice.
 */
export function StateNotice({ tone, text, count, className }: StateNoticeProps): ReactNode {
  return createElement('div', {
    'data-role': 'state-notice',
    'data-tone': tone,
    role: tone === 'error' ? 'alert' : 'status',
    ...(className === undefined ? {} : { className }),
  },
  createElement('span', { 'data-role': 'state-notice-text' }, text),
  count === undefined ? null : createElement('span', { 'data-role': 'state-notice-count' }, String(count)))
}
