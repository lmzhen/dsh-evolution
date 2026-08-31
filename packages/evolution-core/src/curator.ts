/**
 * Deterministic skill curator: active → stale → archived transitions.
 * Pure function with one deliberate side effect: records in the passed
 * `usage` map are MUTATED (state/archived_at) to carry the transition — the
 * caller owns the map and decides whether to clone first (dry-run) or persist
 * after. File moves are performed by SkillLibrary.
 */

import type { UsageMap, UsageRecord } from './usage.ts'
import { latestActivityAt } from './usage.ts'
import { EvolutionGateSet, createGateSet } from './gates.ts'

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
  /** Consolidations actually executed this run (source absorbed into target). */
  consolidated?: CuratorConsolidation[]
  snapshotPath?: string
  /** Whether the LLM nomination pass was enabled for this run (decision visibility). */
  llmReviewEnabled?: boolean
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
  consolidated?: readonly CuratorConsolidation[]
  snapshotPath?: string
  llmReviewEnabled?: boolean
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
    ...input.consolidated === undefined ? {} : { consolidated: [...input.consolidated] },
    ...input.snapshotPath === undefined ? {} : { snapshotPath: input.snapshotPath },
    ...input.llmReviewEnabled === undefined ? {} : { llmReviewEnabled: input.llmReviewEnabled },
  }
}

/**
 * Render a curator run report as a compact human-readable markdown digest
 * (G6): run metadata first, then the notable sections (archived / failed /
 * stale candidates / LLM nominations).
 */
export function renderCuratorReportMarkdown(report: CuratorRunReport): string {
  const lines = [
    `# Curator run ${report.runId}`,
    '',
    `- **Started** ${report.startedAt}`,
    `- **Finished** ${report.finishedAt}`,
    `- **Stale candidates**: ${report.staleCandidates.length}`,
    `- **LLM nominations**: ${report.llmNominations.length}`,
    `- **Archived**: ${report.archived.length}`,
    `- **Failed**: ${report.failed.length}`,
    ...report.snapshotPath === undefined ? [] : [`- **Snapshot**: ${report.snapshotPath}`],
    ...report.llmReviewEnabled === undefined ? [] : [`- **llmReview**: ${report.llmReviewEnabled}`],
  ]
  const section = (title: string, items: string[]): string[] => items.length === 0 ? [] : ['', `## ${title}`, '', ...items.map(item => `- ${item}`)]
  return [
    ...lines,
    ...section('Archived', report.archived.map(item => `${item.name} (${item.reason})`)),
    ...section('Failed', report.failed.map(item => `${item.name}: ${item.reason}`)),
    ...section('Stale candidates', report.staleCandidates),
    ...section('LLM nominations', report.llmNominations),
    '',
  ].join('\n')
}

/** One LLM-nominated consolidation: `from` merges into the umbrella `into`.
 * `mode:'reference'` demotes the source (its body becomes
 * `references/<source>.md` under the umbrella) instead of appending to the
 * target body (009-II); absent means append. */
export interface CuratorConsolidation {
  from: string
  into: string
  mode?: 'append' | 'reference' | undefined
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
  let currentMode: 'append' | 'reference' | undefined
  for (const line of text.split('\n')) {
    const consolidated = /^\s*-\s*from:\s*([a-z0-9][a-z0-9-]*)\s*$/.exec(line)
    if (consolidated) {
      section = 'consolidations'
      currentFrom = consolidated[1] ?? ''
      currentMode = undefined
      continue
    }
    const mode = /^\s*mode:\s*(append|reference)\s*$/.exec(line)
    if (mode) {
      if (currentFrom !== '') currentMode = mode[1] === 'reference' ? 'reference' : 'append'
      continue
    }
    const into = /^\s*into:\s*([a-z0-9][a-z0-9-]*)\s*$/.exec(line)
    if (into) {
      const intoName = into[1] ?? ''
      if (section === 'consolidations' && currentFrom !== '' && currentFrom !== intoName) {
        consolidations.push({
          from: currentFrom,
          into: intoName,
          ...currentMode === undefined ? {} : { mode: currentMode },
        })
      }
      currentFrom = ''
      currentMode = undefined
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

/**
 * The lifecycle-candidate gate, shared by the transition engine and the scope
 * view so the two can never disagree: records failing ANY of these gates are
 * outside the managed scope.
 */
export function lifecycleCandidate(
  name: string,
  record: UsageRecord,
  config: CuratorConfig,
  bundled: boolean,
  gates: EvolutionGateSet = createGateSet(config),
): boolean {
  if (record.pinned) return false
  // One shared GateSet answers exclude / referenced / suppressed and the
  // protected-builtin list (decision B) - identical verdicts to the former
  // three inline set checks plus the builtin check.
  if (gates.isBlocked(name)) return false
  const managed = record.created_by === 'agent' || config.manageUnmanaged === true
  if (!managed && !(config.pruneBuiltins === true && bundled)) return false
  if (record.state === 'archived') return false
  return true
}

export interface ScopeView {
  /** Skills inside the lifecycle scope right now (candidate gate + active state). */
  managed: string[]
  /** Managed skills already flagged stale or quality-warned — the ones to watch. */
  watched: string[]
  /** Managed skills flagged low quality (subset of `watched`) — consolidation candidates. */
  qualityWarned: string[]
  /** Explicitly exempted by excludeSkillNames / referencedSkillNames. */
  exempted: string[]
  /** Carrying a protection marker (pinned / bundled / hub-installed). */
  protected: string[]
}

/**
 * Read-only scope classification, derived from the SAME gate the transition
 * engine uses (`lifecycleCandidate`), so the view always predicts what a
 * curator pass may touch. `protectedNames` carries the marker info the usage
 * records lack (bundled / hub-installed / pinned from `SkillLibrary.list()`).
 */
export function computeScopeView(
  usage: UsageMap,
  config: CuratorConfig,
  protectedNames?: ReadonlyMap<string, string>,
  gates?: EvolutionGateSet,
): ScopeView {
  const managed: string[] = []
  const watched: string[] = []
  const qualityWarned: string[] = []
  const exempted: string[] = []
  const protectedSet = new Set<string>()
  const gateSet = gates ?? createGateSet(config)
  for (const [name, record] of usage) {
    // Bucket semantics are view-specific and unchanged: exclude/referenced
    // read as exempted, suppressed as protected (decision B shares the SETS,
    // not the presentation).
    if (gateSet.exclude.has(name) || gateSet.referenced.has(name)) {
      exempted.push(name)
      continue
    }
    const bundled = config.bundledNames?.has(name) === true
    const suppressed = gateSet.suppressed.has(name)
    if (record.pinned || bundled || suppressed || protectedNames?.has(name) === true) protectedSet.add(name)
    if (lifecycleCandidate(name, record, config, bundled, gateSet)) {
      managed.push(name)
      if (record.state === 'stale' || record.quality_warn === true) watched.push(name)
      if (record.quality_warn === true) qualityWarned.push(name)
    }
  }
  return {
    managed: managed.sort(),
    watched: watched.sort(),
    qualityWarned: qualityWarned.sort(),
    exempted: exempted.sort(),
    protected: [...protectedSet].sort(),
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
  gates?: EvolutionGateSet,
): CuratorResult {
  const result: CuratorResult = { transitions: [], archive: [], reactivate: [], markStale: [] }
  // One GateSet per run (decision B): callers holding a shared instance pass
  // it in so the lifecycle engine and the merge gates can never disagree.
  const gateSet = gates ?? createGateSet(config)
  for (const [name, record] of usage) {
    const bundled = config.bundledNames?.has(name) === true
    if (!lifecycleCandidate(name, record, config, bundled, gateSet)) continue

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
