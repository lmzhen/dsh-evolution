/** One formatter set for both the data table and its narrow card presentation. */
import { formatLocalDateTime } from '@lmzhen/dsh-evolution-client-kit'

export function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString()
}

/** A ratio is shown as a percentage; an absent denominator keeps the explicit dash. */
export function rateText(value: number | null | undefined): string {
  return value === null || value === undefined ? '-' : (value * 100).toFixed(0) + '%'
}

export function lastAtText(value: string | null): string {
  return value === null ? '—' : formatLocalDateTime(value, { seconds: false }) ?? '—'
}

export function statusKey(verdict: string | undefined): string {
  if (verdict === 'warn' || verdict === 'needs-restructure') return 'health.verdict.' + verdict
  if (verdict === 'healthy') return 'stats.verdict.healthy'
  return 'stats.verdict.unknown'
}

export function statusTone(verdict: string | undefined): string {
  if (verdict === 'warn' || verdict === 'needs-restructure') return 'is-warn'
  if (verdict === 'healthy') return 'is-ok'
  return 'is-muted'
}
