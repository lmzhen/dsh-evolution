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
  SkillHealthFacts,
  SkillStatsCounts,
  SkillStatsGovernance,
  SkillStatsRow,
  SkillStatsSnapshot,
  SkillStatsTotals,
  SkillUsageFacts,
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
  return {
    name,
    description: typeof source.description === 'string' ? source.description : '',
    versions: numberOrNull(source.versions) ?? 0,
    lastAt: stringOrNull(source.lastAt),
    health: healthOf(source.health),
    usage: usageOf(source.usage),
    feedback: numberOrNull(source.feedback),
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

function totalsOf(value: unknown, rows: readonly SkillStatsRow[]): SkillStatsTotals {
  const source = recordOf(value)
  const successes = countsOf(source?.successes)
  return {
    skills: numberOrNull(source?.skills) ?? rows.length,
    needsAttention: numberOrNull(source?.needsAttention) ?? rows.filter(row => row.health?.verdict === 'warn' || row.health?.verdict === 'needs-restructure').length,
    bodyChars: numberOrNull(source?.bodyChars),
    supportFiles: numberOrNull(source?.supportFiles),
    successes,
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
  return {
    rows,
    totals: totalsOf(source?.totals, rows),
    counts: countsOf(source?.counts),
    governance: governanceOf(source?.governance),
    generatedAt: stringOrNull(source?.generatedAt) ?? '',
  }
}


