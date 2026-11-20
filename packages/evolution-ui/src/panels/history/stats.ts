/**
 * The full skill-library projection: one read-only snapshot for the data table.
 *
 * The history list answers "what versions does this skill have"; this projection answers "what is
 * the state of the whole library" by joining the curator index, the aggregate health view, the usage
 * store and the feedback scores. It stays in the host half: the browser gets plain data and never
 * reaches for a service.
 *
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/stats
 */

import { latestVersionAt } from '@deepseek-ai/dsh-evolution-core/skills'
import type {
  SkillErrorNote,
  SkillStatsReview,
  SkillStatsReviewSummary,
  SkillHealthFacts,
  SkillStatsCounts,
  SkillStatsGovernance,
  SkillStatsRow,
  SkillStatsSnapshot,
  SkillUsageFacts,
} from '@deepseek-ai/dsh-evolution-core/skills'
import { computeSkillStatsTotals, latestActivityAt, recentlyUsedAt, SKILL_OPERATIONS } from '@deepseek-ai/dsh-evolution-core/skills'
import { isRecord, normalizeUsageRecord, recentViewCount } from '@deepseek-ai/dsh-evolution-core'
import type { CuratorFace, RouteServices } from './routes.ts'

/** The index fields the table needs; listVersions is read once per skill. */
interface SkillIndexRow {
  readonly name: string
  readonly description: string
  readonly versions: number
  readonly lastAt: string | null
}

/** Read the listing once, including skills with no recorded versions. */
export async function readSkillIndex(curator: CuratorFace): Promise<SkillIndexRow[]> {
  const listed = await curator.skills.list()
  const rows: SkillIndexRow[] = []
  for (const skill of listed) {
    const versions = await curator.skills.listVersions(skill.name)
    const lastAt = latestVersionAt(versions)
    rows.push({
      name: skill.name,
      description: skill.description,
      versions: versions.length,
      lastAt,
    })
  }
  return rows
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** Normalize one raw health row; a malformed row stays unmeasured rather than becoming zeros. */
function healthOf(row: unknown): { readonly name: string; readonly facts: SkillHealthFacts } | null {
  const source = objectOf(row)
  const name = typeof source?.name === 'string' ? source.name : ''
  if (name === '') return null
  const dims = objectOf(source?.dims) ?? {}
  const findings = Array.isArray(source?.findings) ? source.findings.length : 0
  return {
    name,
    facts: {
      verdict: typeof source?.verdict === 'string' && source.verdict !== '' ? source.verdict : 'unknown',
      bodyChars: numberOrNull(dims.bodyChars),
      bodyTokens: numberOrNull(dims.bodyTokens),
      supportFiles: numberOrNull(dims.supportFiles),
      stampDensityPerKb: numberOrNull(dims.stampDensityPerKb),
      churnPatches: numberOrNull(dims.churnPatches),
      churnReads: numberOrNull(dims.churnReads),
      hardCapHits: numberOrNull(dims.hardCapHits),
      findings,
    },
  }
}

/** Normalize one usage record; a missing record stays null. */
function usageOf(value: unknown): SkillUsageFacts | null {
  const source = objectOf(value)
  if (source === null) return null
  return {
    useCount: numberOrNull(source.use_count),
    viewCount: numberOrNull(source.view_count),
    viewCount30d: recentViewCount(normalizeUsageRecord(source), 30),
    patchCount: numberOrNull(source.patch_count),
    lastUsedAt: stringOrNull(source.last_used_at),
    lastViewedAt: stringOrNull(source.last_viewed_at),
    lastPatchedAt: stringOrNull(source.last_patched_at),
    state: stringOrNull(source.state),
    pinned: typeof source.pinned === 'boolean' ? source.pinned : null,
  }
}

function countsOf(value: unknown): SkillStatsCounts | null {
  const source = objectOf(value)
  if (source === null) return null
  const offload = numberOrNull(source.offload)
  const condense = numberOrNull(source.condense)
  const extract = numberOrNull(source.extract)
  if (offload === null || condense === null || extract === null) return null
  return { offload, condense, extract }
}

function feedbackOf(value: unknown, name: string): number | null {
  const source = objectOf(value)
  const score = source?.[name]
  return numberOrNull(score)
}

/** Normalize the optional rolling feedback read; null means the service did not answer. */
function feedbackWindowOf(value: unknown): Map<string, { positive: number; negative: number; notes: readonly SkillErrorNote[] }> | null {
  if (value === null || value === undefined) return null
  const entries: Iterable<[string, unknown]> = value instanceof Map
    ? value.entries() as Iterable<[string, unknown]>
    : isRecord(value) ? Object.entries(value) : []
  const out = new Map<string, { positive: number; negative: number; notes: readonly SkillErrorNote[] }>()
  for (const [name, raw] of entries) {
    const source = objectOf(raw)
    const positive = numberOrNull(source?.positive)
    const negative = numberOrNull(source?.negative)
    if (name === '' || positive === null || negative === null) continue
    const notes: SkillErrorNote[] = []
    if (Array.isArray(source?.notes)) {
      for (const entry of source.notes) {
        const noteRow = objectOf(entry)
        const at = typeof noteRow?.at === 'string' ? noteRow.at : ''
        const note = typeof noteRow?.note === 'string' ? noteRow.note.trim() : ''
        if (at === '' || note === '') continue
        notes.push({ at, note })
        if (notes.length >= 10) break
      }
    }
    out.set(name, { positive, negative, notes })
  }
  return out
}

/** Normalize the optional recent-governance read; a malformed row is skipped, not invented. */

function reviewReportOf(value: unknown): { summary: string; memoryChanged: boolean; skillsChanged: readonly string[]; unresolved: readonly string[] } | undefined {
  const source = objectOf(value)
  if (source === null || typeof source.summary !== 'string') return undefined
  const strings = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []
  return { summary: source.summary, memoryChanged: source.memoryChanged === true, skillsChanged: strings(source.skillsChanged), unresolved: strings(source.unresolved) }
}

function reviewsOf(value: unknown): SkillStatsReview[] {
  if (!Array.isArray(value)) return []
  const rows: SkillStatsReview[] = []
  for (const raw of value) {
    const source = objectOf(raw)
    if (source === null) continue
    const reviewId = typeof source.reviewId === 'string' ? source.reviewId : ''
    const report = reviewReportOf(source.report)
    const kind = source.kind === 'memory' || source.kind === 'skill' || source.kind === 'combined' ? source.kind : undefined
    const status = source.status === 'completed' || source.status === 'partial' || source.status === 'failed' || source.status === 'timeout' || source.status === 'aborted' ? source.status : undefined
    const startedAt = numberOrNull(source.startedAt)
    const finishedAt = numberOrNull(source.finishedAt)
    if (reviewId === '' || kind === undefined || status === undefined || startedAt === null || finishedAt === null) continue
    const finiteCount = (input: unknown): number | undefined => typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : undefined
    const requests = finiteCount(source.requests)
    const toolCalls = finiteCount(source.toolCalls)
    const waitCount = finiteCount(source.waitCount)
    const toolMode = source.toolMode === 'native' || source.toolMode === 'ptc' ? source.toolMode : undefined
    const preset = typeof source.preset === 'string' && source.preset !== '' ? source.preset : undefined
    rows.push({
      reviewId,
      kind,
      status,
      startedAt,
      finishedAt,
      ...(typeof source.partialReason === 'string' && source.partialReason !== '' ? { partialReason: source.partialReason } : {}),
      ...(source.hitRoundLimit === true ? { hitRoundLimit: true } : {}),
      ...(requests === undefined ? {} : { requests }),
      ...(toolCalls === undefined ? {} : { toolCalls }),
      ...(waitCount === undefined ? {} : { waitCount }),
      ...(toolMode === undefined ? {} : { toolMode }),
      ...(preset === undefined ? {} : { preset }),
      ...(report === undefined ? {} : { report }),
    })
  }
  return rows
}

/** Aggregate all retained reviews; the snapshot still carries only the newest preview rows. */
function reviewSummaryOf(rows: readonly SkillStatsReview[]): SkillStatsReviewSummary | undefined {
  if (rows.length === 0) return undefined
  const count = (status: SkillStatsReview['status']): number => rows.filter(row => row.status === status).length
  const averages = (pick: (row: SkillStatsReview) => number | undefined): number | null => {
    const values = rows.flatMap(row => { const value = pick(row); return value === undefined ? [] : [value] })
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
  }
  return {
    total: rows.length,
    completed: count('completed'),
    partial: count('partial'),
    timeout: count('timeout'),
    failed: count('failed'),
    aborted: count('aborted'),
    hitRoundLimit: rows.filter(row => row.hitRoundLimit === true).length,
    avgRequests: averages(row => row.requests),
    avgToolCalls: averages(row => row.toolCalls),
  }
}

function governanceOf(value: unknown): SkillStatsGovernance[] {
  if (!Array.isArray(value)) return []
  const rows: SkillStatsGovernance[] = []
  for (const raw of value) {
    const source = objectOf(raw)
    const runId = typeof source?.runId === 'string' ? source.runId : ''
    const startedAt = numberOrNull(source?.startedAt)
    if (runId === '' || startedAt === null) continue
    rows.push({
      runId,
      state: typeof source?.state === 'string' ? source.state : 'unknown',
      startedAt,
      target: stringOrNull(source?.target),
      mode: stringOrNull(source?.mode),
      resultRef: stringOrNull(source?.resultRef),
    })
  }
  return rows
}

/**
 * Build the complete stats snapshot for one request.
 * @param services - the host services the route already resolves.
 * @param curator - the live curator face.
 * @returns rows with per-dimension nulls plus totals, successes and recent governance.
 */
export async function buildSkillStatsSnapshot(services: RouteServices, curator: CuratorFace, now: Date = new Date()): Promise<SkillStatsSnapshot> {
  const index = await readSkillIndex(curator)
  const healthView = services.getHealthView === undefined ? undefined : await services.getHealthView().catch(() => null)
  const healthRows = Array.isArray(healthView) ? healthView : []
  const healthByName = new Map<string, SkillHealthFacts>()
  for (const raw of healthRows) {
    const normalized = healthOf(raw)
    if (normalized !== null) healthByName.set(normalized.name, normalized.facts)
  }

  const usageRead = services.getUsage === undefined ? undefined : await services.getUsage().catch(() => null)
  const usageByName = usageRead instanceof Map ? usageRead as ReadonlyMap<string, unknown> : null
  let feedbackRead: unknown
  try {
    feedbackRead = services.getFeedback?.(index.map(row => row.name))
  } catch {
    feedbackRead = undefined
  }
  const feedbackWindowRead = services.getFeedbackWindow === undefined
    ? null
    : await services.getFeedbackWindow(30).catch(() => null)
  const feedbackWindow = feedbackWindowOf(feedbackWindowRead)
  const counts = countsOf(await services.getCounts?.().catch(() => null) ?? null)
  const governance = governanceOf(await services.getGovernance?.().catch(() => null) ?? null)
  const allReviews = reviewsOf(await services.getReviews?.().catch(() => null) ?? null)
  const reviewSummary = reviewSummaryOf(allReviews)
  const reviews = allReviews.slice(-8).reverse()

  const rows: SkillStatsRow[] = index.map(row => {
    const usage = usageOf(usageByName?.get(row.name))
    const window = feedbackWindow?.get(row.name)
    // A present window map (even an empty one) means the window WAS measured: a missing skill key is
    // zero events, not "unknown". Only an absent/unavailable read is null.
    const measuredWindow = feedbackWindow !== null
    const feedback30d = measuredWindow ? (window?.positive ?? 0) + (window?.negative ?? 0) : null
    const negativeFeedback30d = measuredWindow ? window?.negative ?? 0 : null
    const errorNotes = measuredWindow ? window?.notes ?? [] : null
    const loads30d = usage?.viewCount30d ?? null
    const lastActivityAt = latestActivityAt(usage)
    const verdict = healthByName.get(row.name)?.verdict
    return {
      name: row.name,
      description: row.description,
      versions: row.versions,
      lastChangedAt: row.lastAt,
      lastActivityAt,
      recentlyUsed: recentlyUsedAt(lastActivityAt, now),
      needsAttention: verdict === 'warn' || verdict === 'needs-restructure' || verdict === 'unreadable',
      health: healthByName.get(row.name) ?? null,
      usage,
      feedback: feedbackOf(feedbackRead, row.name),
      feedback30d,
      negativeFeedback30d,
      feedbackRate30d: negativeFeedback30d !== null && loads30d !== null && loads30d > 0 ? negativeFeedback30d / loads30d : null,
      errorNotes,
    }
  })

  const totals = computeSkillStatsTotals(rows, counts)
  return {
    rows,
    global: {
      totals,
      counts,
      governance,
      reviews,
      ...(reviewSummary === undefined ? {} : { reviewSummary }),
      operations: SKILL_OPERATIONS.map(operation => ({ id: operation.id, labelKey: operation.labelKey })),
    },
    generatedAt: new Date().toISOString(),
  }
}

