/**
 * Skill statistics: the read-only domain model shared by the host projection and the browser table.
 *
 * WHY THIS FILE EXISTS: the panel used to carry a probe response, raw health rows, a serialized
 * usage map and a feedback score map as separate ad-hoc shapes. A table needs one row model and one
 * sorting/totals rule; putting it here keeps that rule out of React and out of the HTTP handler.
 *
 * Null semantics are part of the contract: `null` means "not measured / service absent"; `0` means
 * "measured as zero". A sorter or formatter must never collapse the two.
 *
 * @module @deepseek-ai/dsh-evolution-core
 */

import type { SkillOperationId } from './skill-operations.ts'

/** One health dimension the aggregate view exposes for a skill. */
export interface SkillHealthFacts {
  readonly verdict: string
  readonly bodyChars: number | null
  readonly bodyTokens: number | null
  readonly supportFiles: number | null
  readonly stampDensityPerKb: number | null
  readonly churnPatches: number | null
  readonly churnReads: number | null
  readonly hardCapHits: number | null
  readonly findings: number
}

/** One bounded negative-report explanation shown in the skill page's report history. */
export interface SkillErrorNote {
  readonly at: string
  readonly note: string
}

/** One usage fact set; every field stays null when the usage store did not answer for this skill. */
export interface SkillUsageFacts {
  readonly useCount: number | null
  readonly viewCount: number | null
  /** Loads inside the last 30 days; null when the record predates per-day buckets. */
  readonly viewCount30d: number | null
  readonly patchCount: number | null
  readonly lastUsedAt: string | null
  readonly lastViewedAt: string | null
  readonly lastPatchedAt: string | null
  readonly state: string | null
  readonly pinned: boolean | null
}

/** Human-facing "最近使用" window; one constant so host and tests cannot drift. */
export const RECENT_USE_WINDOW_DAYS = 30

/** Newest model load / external use timestamp, or null when neither was measured. */
export function latestActivityAt(usage: SkillUsageFacts | null): string | null {
  let best: string | null = null
  let bestMs = Number.NEGATIVE_INFINITY
  for (const value of [usage?.lastUsedAt ?? null, usage?.lastViewedAt ?? null]) {
    if (value === null) continue
    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) continue
    if (ms > bestMs) {
      best = value
      bestMs = ms
    }
  }
  return best
}

/** Whether an activity timestamp is inside the use window; null when no activity was measured. */
export function recentlyUsedAt(lastActivityAtValue: string | null, now: Date = new Date()): boolean | null {
  if (lastActivityAtValue === null) return null
  const ms = Date.parse(lastActivityAtValue)
  if (!Number.isFinite(ms)) return null
  return ms >= now.getTime() - RECENT_USE_WINDOW_DAYS * 86_400_000
}

/** One row of the full skill table. */
export interface SkillStatsRow {
  readonly name: string
  readonly description: string
  readonly versions: number
  /** Canonical last content change. */
  readonly lastChangedAt: string | null
  /** Newest model load / external use; null when neither timestamp was measured. */
  readonly lastActivityAt: string | null
  /** True when lastActivityAt is inside the 30-day use window; null when no activity was measured. */
  readonly recentlyUsed: boolean | null
  /** Server-derived actionable verdict; the browser must not re-derive it. */
  readonly needsAttention: boolean
  readonly health: SkillHealthFacts | null
  readonly usage: SkillUsageFacts | null
  readonly feedback: number | null
  /** Feedback events inside the last 30 days; null means the rolling window was not measured. */
  readonly feedback30d: number | null
  /** Negative feedback events inside the last 30 days; the rate denominator is loads. */
  readonly negativeFeedback30d: number | null
  /** negativeFeedback30d / loads30d; null when loads30d is null or zero (no denominator). */
  readonly feedbackRate30d: number | null
  /** Negative-report notes in the window, newest first; null when the window was not measured. */
  readonly errorNotes: readonly SkillErrorNote[] | null
}

/** Successful operation counts, as the panel's aggregate read reports them. */
export interface SkillStatsCounts {
  readonly offload: number
  readonly condense: number
  readonly extract: number
}

/** Totals the table strip shows; a null total means at least one contributing row was unmeasured. */
export interface SkillStatsTotals {
  readonly skills: number
  readonly needsAttention: number
  readonly bodyChars: number | null
  /** Sum of the health rows' estimated tokens; null when any contributing row was unmeasured. */
  readonly bodyTokens: number | null
  readonly supportFiles: number | null
  readonly successes: SkillStatsCounts | null
}

/** One recent governance run, as the aggregate read reports it. */
export interface SkillStatsGovernance {
  readonly runId: string
  readonly state: string
  readonly startedAt: number
  readonly target: string | null
  readonly mode: string | null
  readonly resultRef: string | null
}

/** One recent automatic review, as the activity sidecar records it. */
export interface SkillStatsReview {
  readonly reviewId: string
  readonly kind: 'memory' | 'skill' | 'combined'
  readonly status: 'completed' | 'partial' | 'failed' | 'timeout' | 'aborted'
  readonly startedAt: number
  readonly finishedAt: number
  readonly partialReason?: string
}

/** Library-wide facts. These never belong in a single-skill detail view. */
export interface SkillStatsGlobal {
  readonly totals: SkillStatsTotals
  readonly counts: SkillStatsCounts | null
  readonly governance: readonly SkillStatsGovernance[]
  /** Recent automatic reviews; absent means this deployment did not report them. */
  readonly reviews?: readonly SkillStatsReview[]
  /** Label keys for the three success counters; the browser never imports core runtime. */
  readonly operations?: readonly { readonly id: SkillOperationId; readonly labelKey: string }[]
}

/** One complete read of the skill library, as the host route returns it. */
export interface SkillStatsSnapshot {
  readonly rows: readonly SkillStatsRow[]
  /** Library-wide facts live here, never in a single-skill detail view. */
  readonly global: SkillStatsGlobal
  readonly generatedAt: string
}

/** Sortable columns the table exposes. */
export type SkillStatsSortKey =
  | 'name'
  | 'verdict'
  | 'bodyChars'
  | 'bodyTokens'
  | 'supportFiles'
  | 'versions'
  | 'useCount'
  | 'viewCount'
  | 'viewCount30d'
  | 'feedback'
  | 'feedback30d'
  | 'negativeFeedback30d'
  | 'feedbackRate30d'
  | 'lastAt'

export type SortDirection = 'asc' | 'desc'

/** Filter chips in the table header. */
export type SkillStatsFilter = 'all' | 'attention' | 'recent'

/** A verdict that asks the user to act; `healthy` and `unknown` do not. */
export function needsAttention(row: SkillStatsRow): boolean {
  return row.needsAttention
}

/** Severity order for the status column: actionable first, healthy last. */
export function verdictRank(verdict: string | null | undefined): number | null {
  if (verdict === null || verdict === undefined || verdict === '') return null
  if (verdict === 'needs-restructure') return 0
  if (verdict === 'warn') return 1
  if (verdict === 'unreadable') return 2
  if (verdict === 'unknown') return 3
  if (verdict === 'healthy') return 4
  return 5
}

/** Stable name comparison shared by every tie-break. */
function compareNames(left: string, right: string): number {
  return left.localeCompare(right, 'zh-Hans', { numeric: true, sensitivity: 'base' })
}

/** A row's value for one sortable column, or null when that fact was not measured. */
export function sortValue(row: SkillStatsRow, key: SkillStatsSortKey): string | number | null {
  switch (key) {
    case 'name': return row.name
    case 'verdict': return verdictRank(row.health?.verdict)
    case 'bodyChars': return row.health?.bodyChars ?? null
    case 'bodyTokens': return row.health?.bodyTokens ?? null
    case 'supportFiles': return row.health?.supportFiles ?? null
    case 'versions': return row.versions
    case 'useCount': return row.usage?.useCount ?? null
    case 'viewCount': return row.usage?.viewCount ?? null
    case 'viewCount30d': return row.usage?.viewCount30d ?? null
    case 'feedback': return row.feedback
    case 'feedback30d': return row.feedback30d
    case 'negativeFeedback30d': return row.negativeFeedback30d
    case 'feedbackRate30d': return row.feedbackRate30d
    case 'lastAt': return row.lastChangedAt === null ? null : Date.parse(row.lastChangedAt)
  }
}

/**
 * Compare two rows for one column. Nulls always sort last regardless of direction; equal values
 * fall back to the stable name order so pagination-free tables never reshuffle on re-render.
 */
export function compareSkillStats(left: SkillStatsRow, right: SkillStatsRow, key: SkillStatsSortKey, direction: SortDirection): number {
  const a = sortValue(left, key)
  const b = sortValue(right, key)
  const nameCmp = compareNames(left.name, right.name)
  if (a === null && b === null) return nameCmp
  if (a === null) return 1
  if (b === null) return -1
  const cmp = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : compareNames(String(a), String(b))
  if (cmp === 0) return nameCmp
  return direction === 'asc' ? cmp : -cmp
}

/** Return a sorted copy; the snapshot itself is never mutated. */
export function sortSkillStats(rows: readonly SkillStatsRow[], key: SkillStatsSortKey, direction: SortDirection): SkillStatsRow[] {
  return [...rows].sort((left, right) => compareSkillStats(left, right, key, direction))
}

/** Keep only rows matching the header filter. */
export function filterSkillStats(rows: readonly SkillStatsRow[], filter: SkillStatsFilter): SkillStatsRow[] {
  if (filter === 'all') return [...rows]
  if (filter === 'attention') return rows.filter(needsAttention)
  return rows.filter(row => row.recentlyUsed === true)
}

/** Sum a nullable numeric column: all-null means the total itself is unknown, not zero. */
function sumNullable(values: readonly (number | null)[]): number | null {
  let seen = false
  let total = 0
  for (const value of values) {
    if (value === null) continue
    seen = true
    total += value
  }
  return seen ? total : null
}

/** Compute the strip totals from the already-merged rows. */
export function computeSkillStatsTotals(rows: readonly SkillStatsRow[], counts: SkillStatsCounts | null): SkillStatsTotals {
  return {
    skills: rows.length,
    needsAttention: rows.filter(needsAttention).length,
    bodyChars: sumNullable(rows.map(row => row.health?.bodyChars ?? null)),
    bodyTokens: sumNullable(rows.map(row => row.health?.bodyTokens ?? null)),
    supportFiles: sumNullable(rows.map(row => row.health?.supportFiles ?? null)),
    successes: counts,
  }
}
