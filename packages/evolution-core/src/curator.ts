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
import { PROTECTED_BUILTIN_SKILLS, SKILL_NAME_RE } from './constants.ts'

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
  /** Failures attributable to a SKILL NAME (`<name>: …`). V27 CUR-2: this field
   * is the skill-attributable subset only — run-level facts (an abort, a phase
   * that could not start) live in `aborted`/`unattributed` so a report can no
   * longer show `failed: 0` for a run that was cut short. */
  failed: CuratorFailedSkill[]
  /** V27 CUR-2: the run stopped early (e.g. disposed mid-run, timeout). The
   * string names the phase that did not complete; absent on a full run. */
  aborted?: string
  /** V27 CUR-2: error strings that could not be attributed to a skill name.
   * They were previously collected in memory and then dropped on write. */
  unattributed?: string[]
  /** Consolidations actually executed this run (source absorbed into target). */
  consolidated?: CuratorConsolidation[]
  snapshotPath?: string
  /** Whether the LLM nomination pass was enabled for this run (decision visibility). */
  llmReviewEnabled?: boolean
  /** V6-35 (0.3.36): lenient-parse shape notes from the LLM nomination block. */
  nominationsWarnings?: string[]
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
  /** V27 CUR-2: run-level abort reason (see CuratorRunReport.aborted). */
  aborted?: string
  /** V27 CUR-2: errors with no skill name to attribute them to. */
  unattributed?: readonly string[]
  consolidated?: readonly CuratorConsolidation[]
  snapshotPath?: string
  llmReviewEnabled?: boolean
  nominationsWarnings?: readonly string[]
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
    ...input.aborted === undefined ? {} : { aborted: input.aborted },
    ...input.unattributed === undefined || input.unattributed.length === 0 ? {} : { unattributed: [...input.unattributed] },
    ...input.consolidated === undefined ? {} : { consolidated: [...input.consolidated] },
    ...input.snapshotPath === undefined ? {} : { snapshotPath: input.snapshotPath },
    ...input.llmReviewEnabled === undefined ? {} : { llmReviewEnabled: input.llmReviewEnabled },
    ...input.nominationsWarnings === undefined ? {} : { nominationsWarnings: [...input.nominationsWarnings] },
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
    // V27 CUR-2: an aborted run says so on the summary line — the digest is the
    // only artefact an operator reads, and "Failed: 0" over a run that was cut
    // short is the false-clean signal the audit flagged.
    ...report.aborted === undefined ? [] : [`- **Aborted**: ${report.aborted}`],
    ...report.unattributed === undefined || report.unattributed.length === 0
      ? []
      : [`- **Unattributed errors**: ${report.unattributed.length}`],
    ...report.snapshotPath === undefined ? [] : [`- **Snapshot**: ${report.snapshotPath}`],
    ...report.llmReviewEnabled === undefined ? [] : [`- **llmReview**: ${report.llmReviewEnabled}`],
    ...report.nominationsWarnings === undefined || report.nominationsWarnings.length === 0 ? [] : [`- **Nomination warnings**: ${report.nominationsWarnings.join('; ')}`],
  ]
  const section = (title: string, items: string[]): string[] => items.length === 0 ? [] : ['', `## ${title}`, '', ...items.map(item => `- ${item}`)]
  return [
    ...lines,
    ...section('Archived', report.archived.map(item => `${item.name} (${item.reason})`)),
    ...section('Failed', report.failed.map(item => `${item.name}: ${item.reason}`)),
    ...section('Unattributed', report.unattributed ?? []),
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
  /** V6-35 (0.3.36): lenient-parse shape notes (an entry the lenient logic
   * silently dropped or re-routed). Parsing stays lenient — these are advisory
   * and flow into the run report so the operator sees why a mode or a pruning
   * went somewhere unexpected. */
  warnings: string[]
}

// C-12 (v10 audit): NOMINATION_NAME_RE was byte-identical to SKILL_NAME_RE —
// the constant is the single source now, so a future shape change (length
// ceiling, underscore policy) cannot fork curator parsing from the stores.
const NOMINATION_NAME_RE = SKILL_NAME_RE

/**
 * Parse the curator LLM's YAML nomination block (consolidations + prunings).
 * Line-oriented and lenient by design: the LLM output is advisory, every name
 * is re-validated against the tree before any file move happens downstream.
 */
export function parseCuratorNominations(text: string): CuratorNominations {
  const prunings: string[] = []
  const consolidations: CuratorConsolidation[] = []
  const warnings: string[] = []
  let section: 'consolidations' | 'prunings' | null = null
  let currentFrom = ''
  let currentMode: 'append' | 'reference' | undefined
  for (const line of text.split('\n')) {
    // V6-35: the YAML section HEADERS are tracked so a `- name:` under the
    // prunings header (the normal shape) is not mistaken for a misplaced one.
    const header = /^\s*(consolidations|prunings)\s*:\s*$/.exec(line)
    if (header) {
      section = header[1] === 'consolidations' ? 'consolidations' : 'prunings'
      continue
    }
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
      // V6-35: a `mode:` with no preceding `- from:` (or after the `into:` that
      // closed it) is silently dropped — the consolidation stays 'append'.
      // Warn instead so a mis-formed `mode: reference` (demote intent) is
      // visible in the run report instead of degrading to an append.
      else warnings.push(`mode: ${mode[1]} ignored — no preceding "- from:" entry (the consolidation falls back to append)`)
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
      // V6-35: a `- name:` inside the consolidations section flips the parse
      // to prunings — every later entry is re-read as a pruning. Warn so the
      // mis-placement is visible; parsing stays lenient.
      if (section === 'consolidations') warnings.push('"- name:" inside the consolidations section flips the parse to prunings')
      section = 'prunings'
      const name = pruned[1]
      if (name) prunings.push(name)
    }
  }
  const valid = (name: string) => NOMINATION_NAME_RE.test(name)
  return {
    prunings: prunings.filter(valid),
    consolidations: consolidations.filter(item => valid(item.from) && valid(item.into)),
    warnings,
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
  // V8-14 (0.3.47): marker-protected names are NOT candidates — the scope view
  // bucketed them as protected but the transition engine still treated an
  // agent-created marker skill as managed (it appeared in managed[] and
  // protected[] at once, and the engine produced a failed archive step that
  // deleteProtection then refused).
  protectedNames?: ReadonlyMap<string, string>,
): boolean {
  if (record.pinned) return false
  if (protectedNames?.has(name) === true) return false
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
    // V6-36 (0.3.36): a builtin (PROTECTED_BUILTIN_SKILLS — e.g. 'plan') is
    // blocked by the shared gate, so it lands in NO bucket — the view lost an
    // explanation dimension for the skills it must never touch. Bucket it as
    // protected so the view always predicts what a curator pass may touch.
    const isBuiltin = PROTECTED_BUILTIN_SKILLS.has(name)
    if (record.pinned || bundled || suppressed || protectedNames?.has(name) === true || isBuiltin) protectedSet.add(name)
    if (lifecycleCandidate(name, record, config, bundled, gateSet, protectedNames)) {
      managed.push(name)
      // P1-1 (v15): the warn buckets read the UNION of the curator six-factor
      // pair and the feedback pair (same union as the lifecycle engine's
      // stale-window decision, so the view predicts the engine).
      const warned = record.quality_warn === true || record.feedback_warn === true
      if (record.state === 'stale' || warned) watched.push(name)
      if (warned) qualityWarned.push(name)
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
  // A2-9 (v18): an invalid date used to produce NaN and silently freeze the
  // lifecycle comparison (every `idle >= threshold` was false).
  const t = Date.parse(anchor)
  if (!Number.isFinite(t)) return 0
  return (now - t) / 86_400_000
}

export function computeLifecycleTransitions(
  usage: UsageMap,
  config: CuratorConfig,
  now = new Date(),
  gates?: EvolutionGateSet,
  // V8-14 (0.3.47): marker-protected names (bundled / hub-installed / pinned
  // markers from SkillLibrary.list()) never enter the transition engine — the
  // scope view already buckets them as protected; passing the same set keeps
  // the two derivations in agreement.
  protectedNames?: ReadonlyMap<string, string>,
): CuratorResult {
  const result: CuratorResult = { transitions: [], archive: [], reactivate: [], markStale: [] }
  // One GateSet per run (decision B): callers holding a shared instance pass
  // it in so the lifecycle engine and the merge gates can never disagree.
  const gateSet = gates ?? createGateSet(config)
  for (const [name, record] of usage) {
    const bundled = config.bundledNames?.has(name) === true
    if (!lifecycleCandidate(name, record, config, bundled, gateSet, protectedNames)) continue

    const age = daysSince(null, record.created_at, now.getTime())
    // P1-1 (v15): the warn state is the UNION of the curator-owned six-factor
    // pair and the feedback-owned pair — negative feedback must shorten the
    // stale window (that is the feedback package's entire advertised purpose).
    // Field ownership: see `UsageRecord` in usage.ts.
    const qualityWarn = record.quality_warn === true || record.feedback_warn === true
    // P2-12/E-2 (v18): "never used" means never LOADED — `view_count` is the
    // in-tree signal (the platform `skill` tool) and `use_count` an external
    // host signal, so the guard reads both. It used to read `use_count` alone
    // and therefore deferred EVERY skill younger than staleAfterDays,
    // including a quality/feedback-warned one whose short window is exactly
    // what the union read exists for. Warned skills skip the deferral and enter
    // the normal (short-window) decision; the scope view lists them as watched.
    if (record.use_count + record.view_count === 0 && !qualityWarn && age < config.staleAfterDays) continue

    const idle = daysSince(latestActivityAt(record), record.created_at, now.getTime())
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
        // P3 (v16/v17): attribute the warn source so a curator report can tell
        // a user's negative feedback apart from the six-factor score. Tie-break
        // (both flags true): FEEDBACK wins — it is the more informative,
        // user-visible signal; both sources apply the same short window, so
        // this is report attribution only.
        const warnSource = record.feedback_warn === true
          ? 'feedback-warn stale'
          : 'quality-warn stale'
        const reason = qualityWarn
          ? `idle ${Math.round(idle)}d >= ${warnSource} ${staleAfterDays}d`
          : `idle ${Math.round(idle)}d >= ${staleAfterDays}d`
        result.transitions.push({ name, from: 'active', to: 'stale', reason })
        result.markStale.push(name)
      }
    } else {
      // V27 CC-4: the archive bound is checked FIRST here, mirroring the active
      // branch above. The old order tested `idle < staleAfterDays` first, so a
      // contradictory configuration (warn window longer than the archive
      // window, e.g. qualityWarnStaleAfterDays=60 with archiveAfterDays=45)
      // REACTIVATED a stale skill at idle=50d instead of archiving it — the two
      // branches disagreed about the same idle value, and the pair is not
      // validated anywhere. With the archive bound first, the harder bound
      // always wins, and the behavior is otherwise unchanged (for
      // archiveAfterDays >= staleAfterDays the two orders are equivalent).
      if (idle >= config.archiveAfterDays) {
        record.state = 'archived'
        record.archived_at = now.toISOString()
        result.transitions.push({ name, from: 'stale', to: 'archived', reason: `idle ${Math.round(idle)}d >= ${config.archiveAfterDays}d` })
        result.archive.push(name)
      } else if (idle < staleAfterDays) {
        record.state = 'active'
        result.transitions.push({ name, from: 'stale', to: 'active', reason: `recent activity ${Math.round(idle)}d` })
        result.reactivate.push(name)
      }
    }
  }
  return result
}
