/**
 * Deterministic skill curator: active → stale → archived transitions.
 * Pure function; file moves are performed by SkillLibrary.
 */

import type { UsageMap } from './usage.ts'
import { latestActivityAt } from './usage.ts'
import { PROTECTED_BUILTIN_SKILLS } from './constants.ts'

export { PROTECTED_BUILTIN_SKILLS } from './constants.ts'

export interface CuratorConfig {
  staleAfterDays: number
  archiveAfterDays: number
  /** Shorter stale threshold for quality-warned skills; archive threshold never changes. */
  qualityWarnStaleAfterDays?: number
  /** Explicit skill names never considered for lifecycle transitions. */
  excludeSkillNames?: ReadonlySet<string>
  /** When true, usage records without created_by='agent' also enter the lifecycle. */
  manageUnmanaged?: boolean
  /** When true, bundled skills (in `bundledNames`) are curation candidates like agent-created ones. */
  pruneBuiltins?: boolean
  /** Skill names carrying the bundled marker; only read when `pruneBuiltins` is true. */
  bundledNames?: ReadonlySet<string>
  /** Skill names the curator archived once and must not fight across re-seeds. */
  suppressedNames?: ReadonlySet<string>
  /** Skills referenced by scheduled/automated jobs: never auto-transitioned (idle clocks mislead for rarely-firing tasks). */
  referencedSkillNames?: ReadonlySet<string>
}

export interface CuratorTransition {
  name: string
  from: 'active' | 'stale' | 'archived'
  to: 'stale' | 'archived' | 'active'
  reason: string
}

export interface CuratorResult {
  transitions: CuratorTransition[]
  archive: string[]
  reactivate: string[]
  markStale: string[]
}

export interface CuratorArchivedSkill {
  name: string
  path: string
  reason: string
}

export interface CuratorFailedSkill {
  name: string
  reason: string
}

export interface CuratorRunReport {
  /** Report shape version; readers may ignore unknown fields on later versions. */
  schemaVersion: 1
  runId: string
  startedAt: string
  finishedAt: string
  staleCandidates: string[]
  llmNominations: string[]
  archiveCandidates: string[]
  archived: CuratorArchivedSkill[]
  failed: CuratorFailedSkill[]
  snapshotPath?: string
}

export interface CuratorReportInput {
  runId: string
  startedAt: string
  finishedAt: string
  staleCandidates: readonly string[]
  llmNominations: readonly string[]
  archiveCandidates: readonly string[]
  archived: readonly CuratorArchivedSkill[]
  failed: readonly CuratorFailedSkill[]
  snapshotPath?: string
}

export function buildCuratorRunReport(input: CuratorReportInput): CuratorRunReport {
  return {
    schemaVersion: 1,
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    staleCandidates: [...input.staleCandidates],
    llmNominations: [...input.llmNominations],
    archiveCandidates: [...input.archiveCandidates],
    archived: [...input.archived],
    failed: [...input.failed],
    ...input.snapshotPath === undefined ? {} : { snapshotPath: input.snapshotPath },
  }
}

/** One LLM-nominated consolidation: `from` merges into the umbrella `into`. */
export interface CuratorConsolidation {
  from: string
  into: string
}

/** Structured result of the optional curator LLM nomination pass. */
export interface CuratorNominations {
  prunings: string[]
  consolidations: CuratorConsolidation[]
}

const NOMINATION_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

/**
 * Parse the curator LLM's YAML nomination block (consolidations + prunings).
 * Line-oriented and lenient by design: the LLM output is advisory, every name
 * is re-validated against the tree before any file move happens downstream.
 */
export function parseCuratorNominations(text: string): CuratorNominations {
  const prunings: string[] = []
  const consolidations: CuratorConsolidation[] = []
  let section: 'consolidations' | 'prunings' | null = null
  let currentFrom = ''
  for (const line of text.split('\n')) {
    const consolidated = /^\s*-\s*from:\s*([a-z0-9][a-z0-9-]*)\s*$/.exec(line)
    if (consolidated) {
      section = 'consolidations'
      currentFrom = consolidated[1] ?? ''
      continue
    }
    const into = /^\s*into:\s*([a-z0-9][a-z0-9-]*)\s*$/.exec(line)
    if (into) {
      const intoName = into[1] ?? ''
      if (section === 'consolidations' && currentFrom !== '' && currentFrom !== intoName) {
        consolidations.push({ from: currentFrom, into: intoName })
      }
      currentFrom = ''
      continue
    }
    const pruned = /^\s*-\s*name:\s*([a-z0-9][a-z0-9-]*)\s*$/.exec(line)
    if (pruned) {
      section = 'prunings'
      const name = pruned[1]
      if (name) prunings.push(name)
    }
  }
  const valid = (name: string) => NOMINATION_NAME_RE.test(name)
  return {
    prunings: prunings.filter(valid),
    consolidations: consolidations.filter(item => valid(item.from) && valid(item.into)),
  }
}

function daysSince(iso: string | null, created: string, now: number): number {
  const anchor = iso ?? created
  return (now - new Date(anchor).getTime()) / 86_400_000
}

export function computeLifecycleTransitions(
  usage: UsageMap,
  config: CuratorConfig,
  now = new Date(),
): CuratorResult {
  const result: CuratorResult = { transitions: [], archive: [], reactivate: [], markStale: [] }
  for (const [name, record] of usage) {
    if (record.pinned) continue
    if (config.excludeSkillNames?.has(name)) continue
    if (config.suppressedNames?.has(name)) continue
    if (config.referencedSkillNames?.has(name)) continue
    const bundled = config.bundledNames?.has(name) === true
    const managed = record.created_by === 'agent' || config.manageUnmanaged === true
    if (!managed && !(config.pruneBuiltins === true && bundled)) continue
    if (PROTECTED_BUILTIN_SKILLS.has(name)) continue
    if (record.state === 'archived') continue

    const age = daysSince(null, record.created_at, now.getTime())
    if (record.use_count === 0 && age < config.staleAfterDays) continue

    const idle = daysSince(latestActivityAt(record), record.created_at, now.getTime())
    const qualityWarn = record.quality_warn === true
    const staleAfterDays = qualityWarn && config.qualityWarnStaleAfterDays !== undefined
      ? config.qualityWarnStaleAfterDays
      : config.staleAfterDays
    if (record.state === 'active') {
      if (idle >= config.archiveAfterDays) {
        record.state = 'archived'
        record.archived_at = now.toISOString()
        result.transitions.push({ name, from: 'active', to: 'archived', reason: `idle ${Math.round(idle)}d >= ${config.archiveAfterDays}d` })
        result.archive.push(name)
      } else if (idle >= staleAfterDays) {
        record.state = 'stale'
        const reason = qualityWarn
          ? `idle ${Math.round(idle)}d >= quality-warn stale ${staleAfterDays}d`
          : `idle ${Math.round(idle)}d >= ${staleAfterDays}d`
        result.transitions.push({ name, from: 'active', to: 'stale', reason })
        result.markStale.push(name)
      }
    } else {
      if (idle < staleAfterDays) {
        record.state = 'active'
        result.transitions.push({ name, from: 'stale', to: 'active', reason: `recent activity ${Math.round(idle)}d` })
        result.reactivate.push(name)
      } else if (idle >= config.archiveAfterDays) {
        record.state = 'archived'
        record.archived_at = now.toISOString()
        result.transitions.push({ name, from: 'stale', to: 'archived', reason: `idle ${Math.round(idle)}d >= ${config.archiveAfterDays}d` })
        result.archive.push(name)
      }
    }
  }
  return result
}
