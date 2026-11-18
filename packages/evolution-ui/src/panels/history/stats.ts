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
  SkillHealthFacts,
  SkillStatsCounts,
  SkillStatsGovernance,
  SkillStatsRow,
  SkillStatsSnapshot,
  SkillUsageFacts,
} from '@deepseek-ai/dsh-evolution-core/skills'
import { computeSkillStatsTotals } from '@deepseek-ai/dsh-evolution-core/skills'
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
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
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

/** Normalize the optional recent-governance read; a malformed row is skipped, not invented. */
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
export async function buildSkillStatsSnapshot(services: RouteServices, curator: CuratorFace): Promise<SkillStatsSnapshot> {
  const index = await readSkillIndex(curator)
  const healthView = services.getHealthView === undefined ? undefined : await services.getHealthView().catch(() => null)
  const healthRows = Array.isArray(healthView) ? healthView : []
  const healthByName = new Map<string, SkillHealthFacts>()
  for (const raw of healthRows) {
    const normalized = healthOf(raw)
    if (normalized !== null) healthByName.set(normalized.name, normalized.facts)
  }

  const usageRead = await services.getUsage?.()
  const usageByName = usageRead instanceof Map ? usageRead as ReadonlyMap<string, unknown> : null
  const feedbackRead = services.getFeedback?.(index.map(row => row.name))
  const counts = countsOf(await services.getCounts?.().catch(() => null) ?? null)
  const governance = governanceOf(await services.getGovernance?.().catch(() => null) ?? null)

  const rows: SkillStatsRow[] = index.map(row => ({
    name: row.name,
    description: row.description,
    versions: row.versions,
    lastAt: row.lastAt,
    health: healthByName.get(row.name) ?? null,
    usage: usageOf(usageByName?.get(row.name)),
    feedback: feedbackOf(feedbackRead, row.name),
  }))

  return {
    rows,
    totals: computeSkillStatsTotals(rows, counts),
    counts,
    governance,
    generatedAt: new Date().toISOString(),
  }
}
