/** Pure health reading shape: issues first, normal items folded behind a summary. */
import type { HealthRow } from './Panel.ts'

/** The split the health page renders from; counts remain the caller's whole-row facts. */
export interface HealthViewModel {
  readonly issues: readonly HealthRow[]
  readonly normal: readonly HealthRow[]
  readonly hasIssues: boolean
}

/**
 * Split rows without dropping or inventing a verdict. Unreadable is an issue, never normal.
 * @param rows - all rows in the current projection.
 * @returns issues in severity order and the normal remainder.
 */
export function healthViewModel(rows: readonly HealthRow[]): HealthViewModel {
  const order = ['error', 'needs-restructure', 'warn', 'unreadable', 'healthy']
  const sorted = [...rows].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || a.name.localeCompare(b.name))
  const issues = sorted.filter(row => row.verdict !== 'healthy')
  return { issues, normal: sorted.filter(row => row.verdict === 'healthy'), hasIssues: issues.length > 0 }
}
