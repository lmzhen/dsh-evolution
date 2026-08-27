/**
 * Deterministic skill lifecycle curator with interval gate and archive.
 * @module @deepseek-ai/dsh-evolution-curator
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BlockAssembler, createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import { evolutionIoAdapter,  SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { loadUsage, saveUsage, type UsageMap } from '@deepseek-ai/dsh-evolution-core'
import { emptyRecord, loadSuppressedNames, saveSuppressedNames } from '@deepseek-ai/dsh-evolution-core'
import { buildCuratorRunReport, computeLifecycleTransitions, computeQualityScores, computeScopeView, parseCuratorNominations, parseFrontmatter, SKILL_NAME_RE, type CuratorConsolidation, type CuratorNominations, type CuratorRunReport, type ScopeView, type SkillActionResult } from '@deepseek-ai/dsh-evolution-core'
import { evolutionHome, DEFAULT_CURATOR_INTERVAL_HOURS, DEFAULT_MIN_IDLE_HOURS, DEFAULT_STALE_AFTER_DAYS, DEFAULT_ARCHIVE_AFTER_DAYS } from '@deepseek-ai/dsh-evolution-core'
import { CURATOR_PROMPT, CURATOR_DRY_RUN_BANNER } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-state'

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionCurator: EvolutionCurator
  }
}

export interface Config {
  enabled?: boolean
  intervalHours?: number
  staleAfterDays?: number
  archiveAfterDays?: number
  /** Spend one LLM review pass on stale candidates before the deterministic archive step. */
  llmReview?: boolean
  curatorProvider?: string
  /** Quality-warned skills may turn stale after this many idle days. */
  qualityWarnStaleAfterDays?: number
  /** Skip automatic runs while any session was active within this many hours (0 disables). */
  minIdleHours?: number
  /** Skill names excluded from the automated lifecycle. */
  excludeSkillNames?: string[]
  /** Include usage records whose created_by is not 'agent' in lifecycle decisions. */
  manageUnmanaged?: boolean
  /** Archive long-unused bundled skills too (with suppression against re-seeds). */
  pruneBuiltins?: boolean
  /** Static scheduled-task skill references; such skills never auto-transition. */
  referencedSkillNames?: string[]
  /** Start the interval timer on context ready (auto-curation). Default true. */
  autoStart?: boolean
  /** Max tokens for the optional LLM nomination pass. */
  curatorReviewMaxTokens?: number
}

/** Outcome of one curator run pass. */
export interface CuratorRunOutcome {
  stale: string[]
  archived: string[]
  errors: string[]
  report: CuratorRunReport
  skipped?: string
  /** LLM nominations when the optional review pass is enabled (audit visibility). */
  nominations?: CuratorNominations
}

/** Persisted curator-state record shape (schemaVersion optional for legacy reads). */
export interface CuratorStateRecordShape {
  schemaVersion?: number
  lastRunAt: number
  runCount: number
  lastSummary: string
  paused: boolean
}

/**
 * Block LLM-nominated consolidations that would touch a gate-protected name:
 * exclude / referenced / suppressed skills must never merge (neither as the
 * source being archived nor as the umbrella being edited). Mirrors the control
 * plane's `consolidate()` guard; automatic nominations must pass the same gate.
 */
export function gateConsolidations(
  consolidations: CuratorConsolidation[],
  gates: { exclude?: ReadonlySet<string>; referenced?: ReadonlySet<string>; suppressed?: ReadonlySet<string> },
): CuratorConsolidation[] {
  const blocked = (name: string): boolean => gates.exclude?.has(name) === true
    || gates.referenced?.has(name) === true
    || gates.suppressed?.has(name) === true
  return consolidations.filter(n => !blocked(n.from) && !blocked(n.into))
}

export class EvolutionCurator extends Service {  static inject = ['evolutionIo']
  static Config: Schema<Config> = z.object({
    enabled: z.boolean().default(true),
    intervalHours: z.number().default(DEFAULT_CURATOR_INTERVAL_HOURS),
    staleAfterDays: z.number().default(DEFAULT_STALE_AFTER_DAYS),
    archiveAfterDays: z.number().default(DEFAULT_ARCHIVE_AFTER_DAYS),
    llmReview: z.boolean().default(false),
    curatorProvider: z.string().default('deepseek-official'),
    qualityWarnStaleAfterDays: z.number().default(7),
    minIdleHours: z.number().default(DEFAULT_MIN_IDLE_HOURS),
    excludeSkillNames: z.array(z.string()).default([]),
    manageUnmanaged: z.boolean().default(false),
    pruneBuiltins: z.boolean().default(false),
    referencedSkillNames: z.array(z.string()).default([]),
    autoStart: z.boolean().default(true),
    curatorReviewMaxTokens: z.number().default(2048),
  })

  readonly skills: SkillLibrary
  private readonly io: EvolutionIoLike
  private readonly enabled: boolean
  private readonly intervalHours: number
  private readonly staleAfterDays: number
  private readonly archiveAfterDays: number
  private readonly llmReview: boolean
  private readonly curatorProvider: string
  private readonly qualityWarnStaleAfterDays: number
  private readonly minIdleHours: number
  private readonly excludeSkillNames: ReadonlySet<string>
  private readonly manageUnmanaged: boolean
  private readonly pruneBuiltins: boolean
  private readonly referencedSkillNames: ReadonlySet<string>
  private readonly curatorReviewMaxTokens: number
  private lastRun = 0
  private timer: NodeJS.Timeout | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionCurator')
    this.io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
    this.skills = new SkillLibrary(undefined, this.io)
    this.enabled = config.enabled ?? true
    this.intervalHours = config.intervalHours ?? 168
    this.staleAfterDays = config.staleAfterDays ?? 30
    this.archiveAfterDays = config.archiveAfterDays ?? 90
    this.llmReview = config.llmReview ?? false
    this.curatorProvider = config.curatorProvider ?? 'deepseek-official'
    this.qualityWarnStaleAfterDays = config.qualityWarnStaleAfterDays ?? 7
    this.minIdleHours = config.minIdleHours ?? DEFAULT_MIN_IDLE_HOURS
    this.excludeSkillNames = new Set(config.excludeSkillNames ?? [])
    this.manageUnmanaged = config.manageUnmanaged ?? false
    this.pruneBuiltins = config.pruneBuiltins ?? false
    this.referencedSkillNames = new Set(config.referencedSkillNames ?? [])
    this.curatorReviewMaxTokens = config.curatorReviewMaxTokens ?? 2048
    this.lastRun = Date.now()
    this.ctx.effect(() => {
      return () => {
        this.stop()
      }
    }, 'evolution-curator.stop')
    // F2: auto-curation starts with the plugin; the interval gate plus
    // first-run deferral keep a fresh install quiet until the first pass.
    if (config.autoStart ?? true) this.start()
  }

  private lifecycle(): { intervalHours: number; staleAfterDays: number; archiveAfterDays: number } {
    const policy = this.ctx.get('evolutionPolicy') as {
      get(): { curatorIntervalHours: number; staleAfterDays: number; archiveAfterDays: number } | undefined
    } | undefined
    const snapshot = policy?.get()
    return {
      intervalHours: snapshot?.curatorIntervalHours ?? this.intervalHours,
      staleAfterDays: snapshot?.staleAfterDays ?? this.staleAfterDays,
      archiveAfterDays: snapshot?.archiveAfterDays ?? this.archiveAfterDays,
    }
  }

  start(): void {
    if (!this.enabled || this.timer) return
    this.timer = setInterval(() => {
      if (Date.now() - this.lastRun >= this.lifecycle().intervalHours * 3_600_000) void this.run()
    }, 60 * 60 * 1000)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * Optional Hermes-curator LLM pass. The model may only NOMINATE pruning and
   * consolidation; every move stays a control-plane operation and each
   * nomination is re-validated against the tree and protected markers before
   * any file move. `dryRun` prepends the report-only banner.
   */
  async recommend(candidates: string[], options: { dryRun?: boolean } = {}): Promise<CuratorNominations> {
    const empty: CuratorNominations = { prunings: [], consolidations: [] }
    if (candidates.length === 0) return empty
    const llm = this.ctx.get('llm') as {
      stream(options: {
        provider: string
        model: string
        messages: unknown[]
        maxTokens: number
        purpose?: string
      }): AsyncIterable<StreamChunk>
    } | undefined
    if (!llm) return empty
    const policy = this.ctx.get('evolutionPolicy') as { get(): { curatorModel: string } } | undefined
    const model = policy?.get().curatorModel ?? 'deepseek-v4-pro'
    const prompt = [
      options.dryRun ? CURATOR_DRY_RUN_BANNER : '',
      CURATOR_PROMPT,
      '',
      `Stale candidates observed by the deterministic lifecycle scanner:${candidates.length === 0 ? ' (none)' : ''}`,
      ...candidates.map(name => `- ${name}`),
      '',
      'Return a YAML summary with consolidations and prunings lists. Nominate only actions whose archival/merge is clearly safe.',
    ].join('\n')
    try {
      const assembler = new BlockAssembler()
      for await (const chunk of llm.stream({
        provider: this.curatorProvider,
        model,
        messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'plugin', plugin: 'dsh-evolution-curator', form: 'notice', summary: 'curator review' } })],
        maxTokens: this.curatorReviewMaxTokens,
        purpose: 'evolution-curator',
      })) assembler.push(chunk)
      const text = assembler.blocks().filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text').map(block => block.text).join('\n')
      const parsed = parseCuratorNominations(text)
      return {
        prunings: parsed.prunings.filter(name => candidates.includes(name)),
        consolidations: parsed.consolidations,
      }
    } catch {
      // LLM curation is advisory. The deterministic scanner still owns the decision.
      return empty
    }
  }

  private skippedReport(runId: string, startedAt: string): CuratorRunReport {
    return buildCuratorRunReport({
      runId,
      startedAt,
      finishedAt: startedAt,
      staleCandidates: [],
      llmNominations: [],
      archiveCandidates: [],
      archived: [],
      failed: [],
      llmReviewEnabled: this.llmReview,
    })
  }

  /**
   * Run one curator pass. `ignoreGates` skips the interval and idle gates so an
   * explicit `/evolution curator run` always executes (manual-run semantics):
   * `dryRun` computes the lifecycle and the LLM nominations but performs no
   * mutation, reports what WOULD happen, and does not push out the next run.
   */
  async run(options: { ignoreGates?: boolean; dryRun?: boolean } = {}): Promise<CuratorRunOutcome> {
    const { ignoreGates = false, dryRun = false } = options
    const startedAt = new Date().toISOString()
    const runId = randomUUID()
    const stateService = this.ctx.get('evolutionState') as {
      loadCuratorState(): Promise<{ lastRunAt: number; runCount: number; lastSummary: string; paused: boolean } | null>
      saveCuratorState(record: CuratorStateRecordShape): Promise<void>
    } | undefined
    const lifecycle = this.lifecycle()
    const persisted = await stateService?.loadCuratorState()
    if (!ignoreGates && persisted && Date.now() - persisted.lastRunAt < lifecycle.intervalHours * 3_600_000) {
      return {
        stale: [], archived: [], errors: [],
        report: this.skippedReport(runId, startedAt),
        skipped: 'interval',
      }
    }
    if (!ignoreGates && this.minIdleHours > 0 && this.recentSessionActive()) {
      return {
        stale: [], archived: [], errors: [],
        report: this.skippedReport(runId, startedAt),
        skipped: 'active-session',
      }
    }
    // First-sight defer (Hermes `should_run_now` parity): a fresh install with
    // no persisted state seeds the clock and defers instead of running — the
    // interval baseline must start now, not at process construction.
    if (!ignoreGates && persisted === null) {
      await stateService?.saveCuratorState({
        schemaVersion: 1,
        lastRunAt: Date.now(),
        runCount: 0,
        lastSummary: 'first-run-deferred',
        paused: false,
      })
      return {
        stale: [], archived: [], errors: [],
        report: this.skippedReport(runId, startedAt),
        skipped: 'first-run-deferred',
      }
    }
    const root = this.skills.root
    const rawUsage: UsageMap = await loadUsage(root, this.io)
    // Dry-run computes on clones so the persisted lifecycle state is untouched.
    const usage: UsageMap = dryRun ? new Map([...rawUsage].map(([name, record]) => [name, { ...record }])) : rawUsage
    const snapshotPath = dryRun ? undefined : await this.skills.snapshotAll('pre-curator-run')
    const suppressedNames = new Set(await loadSuppressedNames(root, this.io))
    const { bundledNames, treeNames } = await this.seedBaseline(usage)
    const result = computeLifecycleTransitions(usage, {
      staleAfterDays: lifecycle.staleAfterDays,
      archiveAfterDays: lifecycle.archiveAfterDays,
      qualityWarnStaleAfterDays: this.qualityWarnStaleAfterDays,
      excludeSkillNames: this.excludeSkillNames,
      manageUnmanaged: this.manageUnmanaged,
      pruneBuiltins: this.pruneBuiltins,
      bundledNames,
      suppressedNames,
      referencedSkillNames: this.referencedSkillNames,
    })
    await this.scoreTree(usage, treeNames)
    const nominations = this.llmReview ? await this.recommend(result.markStale, { dryRun }) : { prunings: [], consolidations: [] }
    // Automatic merge nominations must pass the same gates as the control
    // plane: excluded/referenced/suppressed skills are never merged (source
    // or target), even when the LLM nominates them.
    const gatedNominations = {
      ...nominations,
      consolidations: gateConsolidations(nominations.consolidations, {
        exclude: this.excludeSkillNames,
        referenced: this.referencedSkillNames,
        suppressed: suppressedNames,
      }),
    }
    const llmNominations = gatedNominations.prunings
    const archiveCandidates = [...new Set([...result.archive, ...llmNominations])]
    const { archivedSkills, errors } = await this.applyMutations({
      dryRun,
      archiveCandidates,
      nominations: gatedNominations,
      treeNames,
      usage,
      bundledNames,
      suppressedNames,
      root,
      failedFrom: new Map(result.transitions.filter(t => t.to === 'archived').map(t => [t.name, t.from as 'active' | 'stale'])),
    })
    if (!dryRun) this.lastRun = Date.now()
    const finishedAt = new Date().toISOString()
    const report = buildCuratorRunReport({
      runId,
      startedAt,
      finishedAt,
      staleCandidates: result.markStale,
      llmNominations,
      archiveCandidates,
      archived: archivedSkills,
      failed: [...new Set([...archiveCandidates, ...gatedNominations.consolidations.map(item => item.from)])]
        .filter(name => errors.some(error => error.startsWith(`${name}:`)))
        .map((name) => {
          const error = errors.find(item => item.startsWith(`${name}:`))
          return { name, reason: error?.slice(name.length + 2) ?? 'unknown' }
        }),
      ...snapshotPath === undefined ? {} : { snapshotPath },
      llmReviewEnabled: this.llmReview,
    })
    const reportsRoot = join(evolutionHome(), 'reports')
    try {
      await this.io.writeText(join(reportsRoot, `curator-${runId}.json`), JSON.stringify(report, null, 2))
    } catch (error) {
      // Report persistence is best-effort; curation decisions already landed.
      this.ctx.logger.warn(`evolution-curator: failed to persist report ${runId}`)
      this.ctx.logger.warn(error)
    }
    // Decision visibility: when the LLM merge channel is off and candidates
    // exist, say so in the state summary instead of hiding the default-choice
    // consequences (deterministic archive only).
    const llmHint = !this.llmReview && result.markStale.length > 0
      ? ' (llmReview: off - deterministic archive only; set llmReview: true for the LLM merge channel)'
      : ''
    const summary = `${dryRun ? 'dry-run' : 'auto'}: stale:${result.markStale.length} archived:${archivedSkills.length} consolidated:${gatedNominations.consolidations.length}${llmHint}`
    await stateService?.saveCuratorState({
      schemaVersion: 1,
      // A dry-run is a preview: it must not push the next scheduled pass out.
      lastRunAt: dryRun ? (persisted?.lastRunAt ?? this.lastRun) : this.lastRun,
      runCount: dryRun ? (persisted?.runCount ?? 0) : (persisted?.runCount ?? 0) + 1,
      lastSummary: summary,
      paused: false,
    })
    return {
      stale: result.markStale,
      archived: archivedSkills.map(item => item.name),
      errors,
      report,
      ...this.llmReview ? { nominations: gatedNominations } : {},
    }
  }

  /**
   * Seed baseline records for tree skills the sidecar has not seen yet, so
   * their inactivity clock starts now (first-sight defer) and bundled skills
   * become known candidates only when prune-builtins opts them in. Also
   * returns the full active tree names for nomination validation.
   */
  private async seedBaseline(usage: UsageMap): Promise<{ bundledNames: Set<string>; treeNames: Set<string> }> {
    const bundledNames = new Set<string>()
    const treeNames = new Set<string>()
    for (const summary of await this.skills.list()) {
      treeNames.add(summary.name)
      if (!usage.has(summary.name)) usage.set(summary.name, emptyRecord())
      if (await this.skills.isBundled(summary.name)) bundledNames.add(summary.name)
      // The marker is the factual source for pinning; mirror it BOTH ways onto
      // the usage record before the lifecycle gate reads it (a marker or a
      // stale mirrored `pinned: true` used to diverge from the gate).
      const record = usage.get(summary.name)
      if (record) record.pinned = await this.skills.isPinned(summary.name)
    }
    return { bundledNames, treeNames }
  }

  /**
   * F13 six-factor quality scoring, persisted onto the usage records.
   */
  private async scoreTree(usage: UsageMap, treeNames: Set<string>): Promise<void> {
    const supportDirs = new Map<string, number>()
    for (const name of treeNames) supportDirs.set(name, await this.skills.countSupportDirs(name))
    const quality = computeQualityScores({ usage, supportDirs, referenceCounts: await this.referenceCounts(treeNames) })
    for (const [name, score] of quality) {
      const record = usage.get(name)
      if (record) {
        record.quality_score = score.score
        record.quality_warn = score.warn
      }
    }
  }

  /**
   * In-degree over explicit `related_skills` frontmatter references (the DSH
   * equivalent of the graph-in-degree references factor): a skill listing
   * other skill names counts as one reference to each of them, so hub skills
   * that are explicitly named by peers get a non-zero references factor.
   */
  private async referenceCounts(treeNames: Set<string>): Promise<Map<string, number>> {
    const counts = new Map<string, number>()
    for (const name of treeNames) {
      const content = await this.skills.read(name)
      if (!content) continue
      const parsed = parseFrontmatter(content)
      if (!parsed) continue
      const raw = parsed.frontmatter['related_skills']
      if (typeof raw !== 'string') continue
      for (const match of Array.from(raw.matchAll(/[a-z0-9][a-z0-9-]*/g))) {
        const target = match[0]
        if (target && SKILL_NAME_RE.test(target) && target !== name) counts.set(target, (counts.get(target) ?? 0) + 1)
      }
    }
    return counts
  }

  /**
   * Execute lifecycle archives and consolidation nominations, then persist the
   * suppression and usage sidecars best-effort. A dry-run short-circuits: no
   * file moves and no state persistence — the caller still writes the report.
   */
  private async applyMutations(input: {
    dryRun: boolean
    archiveCandidates: string[]
    nominations: CuratorNominations
    treeNames: Set<string>
    usage: UsageMap
    bundledNames: Set<string>
    suppressedNames: Set<string>
    root: string
    /** Pre-transition state per archive candidate (for failed-archive rollback). */
    failedFrom?: Map<string, 'active' | 'stale'>
  }): Promise<{ archivedSkills: Array<{ name: string; path: string; reason: string }>; errors: string[]; suppressedChanged: boolean }> {
    if (input.dryRun) return { archivedSkills: [], errors: [], suppressedChanged: false }
    const { archiveCandidates, nominations, treeNames, usage, bundledNames, suppressedNames, root, failedFrom } = input
    const errors: string[] = []
    const archivedSkills: Array<{ name: string; path: string; reason: string }> = []
    let suppressedChanged = false
    for (const name of archiveCandidates) {
      const archived = await this.skills.archive(name, { reason: 'Lifecycle: reached archive threshold', allowBundled: this.pruneBuiltins })
      if (!archived.ok) {
        // A failed archive must roll back to the pre-transition state: a
        // stale->archived failure that left state='archived' would silently
        // drop the stale flag and cause a stale->active->stale oscillation.
        const record = usage.get(name)
        const from = failedFrom?.get(name)
        if (record && (from === 'stale' || from === 'active')) record.state = from
        errors.push(`${name}: ${archived.message}`)
      } else {
        archivedSkills.push({ name, path: archived.path ?? '', reason: 'Lifecycle: reached archive threshold' })
        if (bundledNames.has(name)) {
          suppressedNames.add(name)
          suppressedChanged = true
        }
      }
    }
    const alreadyArchived = new Set(archiveCandidates)
    for (const nomination of nominations.consolidations) {
      if (alreadyArchived.has(nomination.from)) continue
      if (!treeNames.has(nomination.from) || !treeNames.has(nomination.into)) {
        errors.push(`${nomination.from}: consolidation target or source missing from the skill tree`)
        continue
      }
      const consolidated = await this.skills.consolidate(nomination.into, [nomination.from], 'background_review')
      if (!consolidated.ok) {
        errors.push(`${nomination.from}: ${consolidated.message}`)
        continue
      }
      const record = usage.get(nomination.from)
      if (record) {
        record.state = 'archived'
        record.archived_at = new Date().toISOString()
      }
      alreadyArchived.add(nomination.from)
      // Approximate recovered location: the exact archive dir may carry a
      // stamp suffix, but consolidated.path points at the TARGET, not the
      // archived source, so it must not be reported as the source's path.
      archivedSkills.push({ name: nomination.from, path: join(this.skills.root, '.archive', nomination.from), reason: `Consolidated into ${nomination.into}` })
    }
    if (suppressedChanged) {
      try {
        await saveSuppressedNames(root, suppressedNames, this.io)
      } catch {
        // Best-effort like the report write: a transient disk failure must not
        // make a run that already archived skills throw after the fact.
        this.ctx.logger.warn('evolution-curator: failed to persist suppressed names; archived built-ins may re-enter the lifecycle')
      }
    }
    try {
      await saveUsage(root, usage, this.io)
    } catch {
      // Best-effort: curation decisions already landed; a failed usage flush
      // must not surface as a run error after the fact.
      this.ctx.logger.warn('evolution-curator: failed to persist usage sidecar')
    }
    return { archivedSkills, errors, suppressedChanged }
  }

  private recentSessionActive(): boolean {
    const agents = this.ctx.get('agents') as {
      list(): Array<{ session: { events: ReadonlyArray<{ time: number }> } }>
    } | undefined
    if (!agents) return false
    let latest = 0
    for (const agent of agents.list()) {
      const events = agent.session.events
      const last = events.length === 0 ? 0 : events[events.length - 1]?.time ?? 0
      latest = Math.max(latest, last)
    }
    return latest > 0 && Date.now() - latest < this.minIdleHours * 3_600_000
  }

  async latestReport(): Promise<CuratorRunReport | null> {
    const reportsRoot = join(evolutionHome(), 'reports')
    const names = (await this.io.list(reportsRoot)).filter(name => name.startsWith('curator-') && name.endsWith('.json')).sort().reverse()
    const latest = names[0]
    if (!latest) return null
    const raw = await this.io.readText(join(reportsRoot, latest))
    if (raw === null) return null
    try { return JSON.parse(raw) as CuratorRunReport } catch { return null }
  }

  /**
   * Read-only lifecycle scope classification: which skills are in scope,
   * watched (stale/quality-warned), exempted, or protected. Uses the same
   * candidate gate as `run()` (`computeScopeView` / `lifecycleCandidate`),
   * so the view always predicts what a curator pass may touch.
   */
  async scopeView(): Promise<ScopeView> {
    const root = this.skills.root
    const usage: UsageMap = await loadUsage(root, this.io)
    const { bundledNames } = await this.seedBaseline(usage)
    return computeScopeView(usage, {
      staleAfterDays: this.lifecycle().staleAfterDays,
      archiveAfterDays: this.lifecycle().archiveAfterDays,
      excludeSkillNames: this.excludeSkillNames,
      referencedSkillNames: this.referencedSkillNames,
      suppressedNames: new Set(await loadSuppressedNames(root, this.io)),
      manageUnmanaged: this.manageUnmanaged,
      pruneBuiltins: this.pruneBuiltins,
      bundledNames,
    }, await this.protectedNameMap())
  }

  /** marker info (pinned/bundled/hub-installed) per skill, from the library list. */
  private async protectedNameMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    for (const summary of await this.skills.list()) {
      if (summary.protectedBy !== null) map.set(summary.name, summary.protectedBy)
    }
    return map
  }

  /**
   * Control-plane consolidation: merge source skill bodies into `target`,
   * archive the sources with an absorbed-into marker, and fold their usage
   * records into `archived` state. Snapshot-then-mutate, never a hard delete.
   */
  async consolidate(target: string, sources: string[]): Promise<SkillActionResult> {
    const blocked = [...this.excludeSkillNames].filter(name => name === target || sources.includes(name))
    if (blocked.length > 0) return { ok: false, message: `Skill(s) excluded from lifecycle management: ${blocked.join(', ')}` }
    await this.skills.snapshotAll('pre-consolidate')
    const result = await this.skills.consolidate(target, sources)
    if (!result.ok) return result
    const usage: UsageMap = await loadUsage(this.skills.root, this.io)
    for (const source of sources) {
      const record = usage.get(source)
      if (record) record.state = 'archived'
      if (record) record.archived_at = new Date().toISOString()
    }
    await saveUsage(this.skills.root, usage, this.io)
    return result
  }

  /**
   * Control-plane restore: bring one archived skill back to the active root
   * and reset its usage state, keeping the recoverable-archive invariant.
   */
  async restore(name: string): Promise<SkillActionResult> {
    await this.skills.snapshotAll('pre-restore')
    const result = await this.skills.restoreFromArchive(name)
    if (!result.ok) return result
    const usage: UsageMap = await loadUsage(this.skills.root, this.io)
    const record = usage.get(name)
    if (record) record.state = 'active'
    if (record) record.archived_at = null
    await saveUsage(this.skills.root, usage, this.io)
    const suppressed = new Set(await loadSuppressedNames(this.skills.root, this.io))
    if (suppressed.delete(name)) {
      try {
        await saveSuppressedNames(this.skills.root, suppressed, this.io)
      } catch {
        // The restore itself already landed; suppression cleanup is best-effort.
        this.ctx.logger.warn(`evolution-curator: failed to persist suppressed names after restoring ${name}`)
      }
    }
    return result
  }
}

export default EvolutionCurator
