/** The one local-time presentation used by reading surfaces. */
import { createElement, type ReactNode } from 'react'
import { formatLocalDateTime } from '../format.ts'

/** Props for the shared time text. */
export interface TimeTextProps {
  readonly value: string | number | null | undefined
  readonly seconds?: boolean | undefined
  readonly className?: string | undefined
}

/**
 * Render a local wall time, or a neutral dash when the fact is unknown.
 * @param props - ISO/epoch value and seconds preference.
 * @returns a time element with the raw value in dateTime when valid.
 */
export function TimeText({ value, seconds = true, className }: TimeTextProps): ReactNode {
  const text = formatLocalDateTime(value, { seconds })
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN
  const raw = Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
  return createElement('time', {
    'data-role': 'time-text',
    ...(raw === undefined ? {} : { dateTime: raw }),
    ...(text === null ? {} : { title: text }),
    ...(className === undefined ? {} : { className }),
  }, text ?? '—')
}
