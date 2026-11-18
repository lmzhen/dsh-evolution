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

/** One row of the full skill table. */
export interface SkillStatsRow {
  readonly name: string
  readonly description: string
  readonly versions: number
  /** Last content change, or null when the skill has no recorded versions. */
  readonly lastAt: string | null
  readonly health: SkillHealthFacts | null
  readonly usage: SkillUsageFacts | null
  readonly feedback: number | null
  /** Feedback events inside the last 30 days; null means the rolling window was not measured. */
  readonly feedback30d: number | null
  /** Negative feedback events inside the last 30 days; the rate denominator is loads. */
  readonly negativeFeedback30d: number | null
  /** negativeFeedback30d / loads30d; null when loads30d is null or zero (no denominator). */
  readonly feedbackRate30d: number | null
  /** Negative-report notes in the window, newest last; null when the window was not measured. */
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

/** One complete read of the skill library, as the host route returns it. */
export interface SkillStatsSnapshot {
  readonly rows: readonly SkillStatsRow[]
  readonly totals: SkillStatsTotals
  readonly counts: SkillStatsCounts | null
  readonly governance: readonly SkillStatsGovernance[]
  readonly generatedAt: string
}

/** Sortable columns the table exposes. */
export type SkillStatsSortKey =
  | 'name'
  | 'verdict'
  | 'bodyChars'
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
  const verdict = row.health?.verdict
  return verdict === 'warn' || verdict === 'needs-restructure'
}

/** Severity order for the status column: actionable first, healthy last. */
export function verdictRank(verdict: string | null | undefined): number | null {
  if (verdict === null || verdict === undefined || verdict === '') return null
  if (verdict === 'needs-restructure') return 0
  if (verdict === 'warn') return 1
  if (verdict === 'unknown') return 2
  if (verdict === 'healthy') return 3
  return 4
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
    case 'supportFiles': return row.health?.supportFiles ?? null
    case 'versions': return row.versions
    case 'useCount': return row.usage?.useCount ?? null
    case 'viewCount': return row.usage?.viewCount ?? null
    case 'viewCount30d': return row.usage?.viewCount30d ?? null
    case 'feedback': return row.feedback
    case 'feedback30d': return row.feedback30d
    case 'negativeFeedback30d': return row.negativeFeedback30d
    case 'feedbackRate30d': return row.feedbackRate30d
    case 'lastAt': return row.lastAt === null ? null : Date.parse(row.lastAt)
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
  return rows.filter(row => row.lastAt !== null)
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
    supportFiles: sumNullable(rows.map(row => row.health?.supportFiles ?? null)),
    successes: counts,
  }
}
