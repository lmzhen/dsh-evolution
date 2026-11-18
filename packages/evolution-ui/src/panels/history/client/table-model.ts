/**
 * Browser-safe table model for the stats page.
 *
 * The browser bundle externalizes `@deepseek-ai/*` at runtime, so it cannot call the host's core
 * comparators directly. The types still come from core (type-only) and `table-model.parity.spec.ts`
 * pins this copy's ordering/totals behaviour against the core functions.
 *
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import type { SkillStatsFilter, SkillStatsRow, SkillStatsSortKey, SortDirection } from '@deepseek-ai/dsh-evolution-core/skills'

/** The actionable verdicts, same rule as core's `needsAttention`. */
export function needsAttention(row: SkillStatsRow): boolean {
  return row.health?.verdict === 'warn' || row.health?.verdict === 'needs-restructure'
}

function verdictRank(verdict: string | undefined): number | null {
  if (verdict === undefined || verdict === '') return null
  if (verdict === 'needs-restructure') return 0
  if (verdict === 'warn') return 1
  if (verdict === 'unknown') return 2
  if (verdict === 'healthy') return 3
  return 4
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, 'zh-Hans', { numeric: true, sensitivity: 'base' })
}

export function sortValue(row: SkillStatsRow, key: SkillStatsSortKey): string | number | null {
  switch (key) {
    case 'name': return row.name
    case 'verdict': return verdictRank(row.health?.verdict)
    case 'bodyChars': return row.health?.bodyChars ?? null
    case 'supportFiles': return row.health?.supportFiles ?? null
    case 'versions': return row.versions
    case 'useCount': return row.usage?.useCount ?? null
    case 'viewCount': return row.usage?.viewCount ?? null
    case 'viewCount30d': return row.usage?.viewCount30d ?? null
    case 'feedback': return row.feedback
    case 'feedback30d': return row.feedback30d
    case 'feedbackRate30d': return row.feedbackRate30d
    case 'lastAt': return row.lastAt === null ? null : Date.parse(row.lastAt)
  }
}

export function compareRows(left: SkillStatsRow, right: SkillStatsRow, key: SkillStatsSortKey, direction: SortDirection): number {
  const a = sortValue(left, key)
  const b = sortValue(right, key)
  const nameCmp = compareNames(left.name, right.name)
  if (a === null && b === null) return nameCmp
  if (a === null) return 1
  if (b === null) return -1
  const cmp = typeof a === 'number' && typeof b === 'number' ? a - b : compareNames(String(a), String(b))
  if (cmp === 0) return nameCmp
  return direction === 'asc' ? cmp : -cmp
}

export function sortRows(rows: readonly SkillStatsRow[], key: SkillStatsSortKey, direction: SortDirection): SkillStatsRow[] {
  return [...rows].sort((left, right) => compareRows(left, right, key, direction))
}

export function filterRows(rows: readonly SkillStatsRow[], filter: SkillStatsFilter): SkillStatsRow[] {
  if (filter === 'all') return [...rows]
  if (filter === 'attention') return rows.filter(needsAttention)
  return rows.filter(row => row.lastAt !== null)
}
