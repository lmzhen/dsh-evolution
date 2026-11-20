/**
 * Normalize the host's stats snapshot into the browser's row model.
 *
 * This file is intentionally transport-adjacent: it knows the wire shape and nothing about React,
 * sorting or copy. Every absent fact stays null; a malformed row is skipped rather than turned into
 * a zero row. The type-only import keeps one model shared with the host without pulling core runtime
 * into the browser bundle.
 *
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import { isRecord } from './guards.ts'
import type {
  SkillErrorNote,
  SkillHealthFacts,
  SkillStatsCounts,
  SkillStatsGovernance,
  SkillStatsRow,
  SkillStatsReview,
  SkillStatsReviewSummary,
  SkillStatsSnapshot,
  SkillStatsTotals,
  SkillUsageFacts,
  SkillOperationId,
} from '@deepseek-ai/dsh-evolution-core/skills'

function recordOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function errorNotesOf(value: unknown): SkillErrorNote[] | null {
  if (!Array.isArray(value)) return null
  const notes: SkillErrorNote[] = []
  for (const raw of value) {
    const source = recordOf(raw)
    const at = stringOrNull(source?.at)
    const note = stringOrNull(source?.note)
    if (at === null || note === null) continue
    notes.push({ at, note })
    if (notes.length >= 10) break
  }
  return notes
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function healthOf(value: unknown): SkillHealthFacts | null {
  const source = recordOf(value)
  if (source === null) return null
  return {
    verdict: typeof source.verdict === 'string' && source.verdict !== '' ? source.verdict : 'unknown',
    bodyChars: numberOrNull(source.bodyChars),
    bodyTokens: numberOrNull(source.bodyTokens),
    supportFiles: numberOrNull(source.supportFiles),
    stampDensityPerKb: numberOrNull(source.stampDensityPerKb),
    churnPatches: numberOrNull(source.churnPatches),
    churnReads: numberOrNull(source.churnReads),
    hardCapHits: numberOrNull(source.hardCapHits),
    findings: numberOrNull(source.findings) ?? 0,
  }
}

function usageOf(value: unknown): SkillUsageFacts | null {
  const source = recordOf(value)
  if (source === null) return null
  return {
    useCount: numberOrNull(source.useCount),
    viewCount: numberOrNull(source.viewCount),
    viewCount30d: numberOrNull(source.viewCount30d),
    patchCount: numberOrNull(source.patchCount),
    lastUsedAt: stringOrNull(source.lastUsedAt),
    lastViewedAt: stringOrNull(source.lastViewedAt),
    lastPatchedAt: stringOrNull(source.lastPatchedAt),
    state: stringOrNull(source.state),
    pinned: booleanOrNull(source.pinned),
  }
}

function rowOf(value: unknown): SkillStatsRow | null {
  const source = recordOf(value)
  const name = typeof source?.name === 'string' ? source.name : ''
  if (source === null || name === '') return null
  const lastChangedAt = stringOrNull(source.lastChangedAt) ?? stringOrNull(source.lastAt)
  const health = healthOf(source.health)
  const needsAttention = source.needsAttention === true
  return {
    name,
    description: typeof source.description === 'string' ? source.description : '',
    versions: numberOrNull(source.versions) ?? 0,
    lastChangedAt,
    lastActivityAt: stringOrNull(source.lastActivityAt),
    recentlyUsed: booleanOrNull(source.recentlyUsed),
    needsAttention,
    health,
    usage: usageOf(source.usage),
    feedback: numberOrNull(source.feedback),
    feedback30d: numberOrNull(source.feedback30d),
    negativeFeedback30d: numberOrNull(source.negativeFeedback30d),
    feedbackRate30d: numberOrNull(source.feedbackRate30d),
    errorNotes: errorNotesOf(source.errorNotes),
  }
}

function countsOf(value: unknown): SkillStatsCounts | null {
  const source = recordOf(value)
  if (source === null) return null
  const offload = numberOrNull(source.offload)
  const condense = numberOrNull(source.condense)
  const extract = numberOrNull(source.extract)
  return offload === null || condense === null || extract === null ? null : { offload, condense, extract }
}

function operationsOf(value: unknown): readonly { readonly id: SkillOperationId; readonly labelKey: string }[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = new Set<SkillOperationId>(['offload', 'condense', 'extract'])
  const out: { id: SkillOperationId; labelKey: string }[] = []
  for (const raw of value) {
    const source = recordOf(raw)
    if (source === null) continue
    const id = typeof source.id === 'string' && ids.has(source.id as SkillOperationId) ? source.id as SkillOperationId : undefined
    const labelKey = typeof source.labelKey === 'string' && source.labelKey !== '' ? source.labelKey : undefined
    if (id !== undefined && labelKey !== undefined) out.push({ id, labelKey })
  }
  return out
}

function totalsOf(value: unknown, rows: readonly SkillStatsRow[]): SkillStatsTotals {  const source = recordOf(value)
  const successes = countsOf(source?.successes)
  return {
    skills: numberOrNull(source?.skills) ?? rows.length,
    needsAttention: numberOrNull(source?.needsAttention) ?? rows.filter(row => row.needsAttention).length,
    bodyChars: numberOrNull(source?.bodyChars),
    bodyTokens: numberOrNull(source?.bodyTokens),
    supportFiles: numberOrNull(source?.supportFiles),
    successes,
  }
}


function reviewsOf(value: unknown): SkillStatsReview[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows: SkillStatsReview[] = []
  for (const raw of value) {
    const source = recordOf(raw)
    if (source === null) continue
    const reviewId = typeof source.reviewId === 'string' && source.reviewId !== '' ? source.reviewId : undefined
    const kind = source.kind === 'memory' || source.kind === 'skill' || source.kind === 'combined' ? source.kind : undefined
    const status = source.status === 'completed' || source.status === 'partial' || source.status === 'failed' || source.status === 'timeout' || source.status === 'aborted' ? source.status : undefined
    const startedAt = numberOrNull(source.startedAt)
    const finishedAt = numberOrNull(source.finishedAt)
    if (reviewId === undefined || kind === undefined || status === undefined || startedAt === null || finishedAt === null) continue
    const report = recordOf(source.report)
    const strings = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []
    rows.push({
      reviewId, kind, status, startedAt, finishedAt,
      ...(typeof source.partialReason === 'string' && source.partialReason !== '' ? { partialReason: source.partialReason } : {}),
      ...(source.hitRoundLimit === true ? { hitRoundLimit: true } : {}),
      ...(numberOrNull(source.requests) === null ? {} : { requests: numberOrNull(source.requests)! }),
      ...(numberOrNull(source.toolCalls) === null ? {} : { toolCalls: numberOrNull(source.toolCalls)! }),
      ...(numberOrNull(source.waitCount) === null ? {} : { waitCount: numberOrNull(source.waitCount)! }),
      ...(source.toolMode === 'native' || source.toolMode === 'ptc' ? { toolMode: source.toolMode } : {}),
      ...(typeof source.preset === 'string' && source.preset !== '' ? { preset: source.preset } : {}),
      ...(report !== null && typeof report.summary === 'string' ? { report: { summary: report.summary, memoryChanged: report.memoryChanged === true, skillsChanged: strings(report.skillsChanged), unresolved: strings(report.unresolved) } } : {}),
    })
  }
  return rows
}

function reviewSummaryOf(value: unknown): SkillStatsReviewSummary | undefined {
  const source = recordOf(value)
  if (source === null) return undefined
  const count = (key: string): number | null => numberOrNull(source[key])
  const total = count('total')
  const completed = count('completed')
  const partial = count('partial')
  const timeout = count('timeout')
  const failed = count('failed')
  if (total === null || completed === null || partial === null || timeout === null || failed === null) return undefined
  return {
    total,
    completed,
    partial,
    timeout,
    failed,
    aborted: count('aborted') ?? 0,
    hitRoundLimit: count('hitRoundLimit') ?? 0,
    avgRequests: count('avgRequests'),
    avgToolCalls: count('avgToolCalls'),
  }
}

function governanceOf(value: unknown): SkillStatsGovernance[] {
  if (!Array.isArray(value)) return []
  const rows: SkillStatsGovernance[] = []
  for (const raw of value) {
    const source = recordOf(raw)
    if (source === null) continue
    const runId = typeof source?.runId === 'string' ? source.runId : ''
    const startedAt = numberOrNull(source?.startedAt)
    if (runId === '' || startedAt === null) continue
    rows.push({
      runId,
      state: typeof source.state === 'string' ? source.state : 'unknown',
      startedAt,
      target: stringOrNull(source.target),
      mode: stringOrNull(source.mode),
      resultRef: stringOrNull(source.resultRef),
    })
  }
  return rows
}

/**
 * Parse one stats response body. Rows with no name are dropped; every valid row keeps nulls.
 * @param value - the route's `data` payload.
 * @returns a snapshot safe to render and sort.
 */
export function parseSkillStats(value: unknown): SkillStatsSnapshot {
  const source = recordOf(value)
  const rows = Array.isArray(source?.rows)
    ? source.rows.map(rowOf).filter((row): row is SkillStatsRow => row !== null)
    : []
  const totals = totalsOf(source?.totals, rows)
  const counts = countsOf(source?.counts)
  const governance = governanceOf(source?.governance)
  const globalSource = recordOf(source?.global)
  const globalGovernance = governanceOf(globalSource?.governance)
  const operations = operationsOf(globalSource?.operations)
  const reviews = reviewsOf(globalSource?.reviews)
  const reviewSummary = reviewSummaryOf(globalSource?.reviewSummary)
  const global = {
    totals: globalSource?.totals === undefined ? totals : totalsOf(globalSource.totals, rows),
    counts: countsOf(globalSource?.counts) ?? counts,
    governance: globalGovernance.length > 0 ? globalGovernance : governance,
    ...(operations === undefined ? {} : { operations }),
    ...(reviews === undefined ? {} : { reviews }),
    ...(reviewSummary === undefined ? {} : { reviewSummary }),
  }
  return {
    rows,
    global,
    generatedAt: stringOrNull(source?.generatedAt) ?? '',
  }
}


