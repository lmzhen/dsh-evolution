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
import { EvolutionGateSet, evolutionIoAdapter, relatedSkillNames, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { foldCuratorFields, loadUsage, mutateUsage, type UsageMap } from '@deepseek-ai/dsh-evolution-core'
import { emptyRecord, loadSuppressedNames, updateSuppressedNames } from '@deepseek-ai/dsh-evolution-core'
import { computeDedupGroups, buildCuratorRunReport, computeLifecycleTransitions, computePrefixClusters, computeQualityScores, computeScopeView, parseCuratorNominations, renderCuratorReportMarkdown, type CuratorConsolidation, type CuratorNominations, type CuratorRunReport, type ScopeView, type SkillActionResult, type SkillHealthVerdict } from '@deepseek-ai/dsh-evolution-core'
import { evolutionHome, DEFAULT_CURATOR_INTERVAL_HOURS, DEFAULT_HEALTH_THRESHOLDS, DEFAULT_MIN_IDLE_HOURS, DEFAULT_STALE_AFTER_DAYS, DEFAULT_ARCHIVE_AFTER_DAYS } from '@deepseek-ai/dsh-evolution-core'
import { CURATOR_PROMPT, CURATOR_DRY_RUN_BANNER } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-state'


/** Quality-warned skills may turn stale after this many idle days (package-private tunable, P2-8). */

const DEFAULT_QUALITY_WARN_STALE_AFTER_DAYS = 7


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
  /** Seconds between host boot and the first automatic schedule check (restart catch-up). */
  bootGraceSeconds?: number
  /** Max tokens for the optional LLM nomination pass. */
  curatorReviewMaxTokens?: number
  /** Structure-health soft body limit (chars) — see DEFAULT_HEALTH_THRESHOLDS (rc.73 A1). */
  healthSoftBodyChars?: number
  /** Structure-health stamp-density ceiling per KB — see DEFAULT_HEALTH_THRESHOLDS. */
  healthStampDensityPerKb?: number
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
  gates: EvolutionGateSet | { exclude?: ReadonlySet<string>; referenced?: ReadonlySet<string>; suppressed?: ReadonlySet<string> },
): CuratorConsolidation[] {
  // Decision B: the same GateSet the lifecycle engine reads - and it now also
  // blocks protected builtins (e.g. `plan`) that the name-set check missed.
  const gateSet = gates instanceof EvolutionGateSet ? gates : new EvolutionGateSet(gates)
  return consolidations.filter(n => !gateSet.isBlocked(n.from) && !gateSet.isBlocked(n.into))
}

export class EvolutionCurator extends Service {  static inject = ['evolutionIo']
  static Config: Schema<Config> = z.object({
    enabled: z.boolean().default(true),
    intervalHours: z.number().default(DEFAULT_CURATOR_INTERVAL_HOURS),
    staleAfterDays: z.number().default(DEFAULT_STALE_AFTER_DAYS),
    archiveAfterDays: z.number().default(DEFAULT_ARCHIVE_AFTER_DAYS),
    llmReview: z.boolean().default(false),
    curatorProvider: z.string().default('deepseek-official'),
    qualityWarnStaleAfterDays: z.number().default(DEFAULT_QUALITY_WARN_STALE_AFTER_DAYS),
    minIdleHours: z.number().default(DEFAULT_MIN_IDLE_HOURS),
    excludeSkillNames: z.array(z.string()).default([]),
    manageUnmanaged: z.boolean().default(false),
    pruneBuiltins: z.boolean().default(false),
    referencedSkillNames: z.array(z.string()).default([]),
    autoStart: z.boolean().default(true),
    bootGraceSeconds: z.number().default(10),
    curatorReviewMaxTokens: z.number().default(2048),
    healthSoftBodyChars: z.number().default(DEFAULT_HEALTH_THRESHOLDS.softBodyChars),
    healthStampDensityPerKb: z.number().default(DEFAULT_HEALTH_THRESHOLDS.stampDensityPerKb),
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
  private readonly bootGraceSeconds: number
  private readonly curatorReviewMaxTokens: number
  private readonly healthSoftBodyChars: number
  private readonly healthStampDensityPerKb: number
  private lastRun = 0
  private timer: NodeJS.Timeout | undefined
  private bootCheck: NodeJS.Timeout | undefined
  private running = false

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionCurator')
    this.io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
    this.skills = new SkillLibrary(undefined, this.io, undefined, (event) => { this.ctx.emit('evolution/skill-mutated', event) })
    this.enabled = config.enabled ?? true
    this.intervalHours = config.intervalHours ?? DEFAULT_CURATOR_INTERVAL_HOURS
    this.staleAfterDays = config.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS
    this.archiveAfterDays = config.archiveAfterDays ?? DEFAULT_ARCHIVE_AFTER_DAYS
    this.llmReview = config.llmReview ?? false
    this.curatorProvider = config.curatorProvider ?? 'deepseek-official'
    this.qualityWarnStaleAfterDays = config.qualityWarnStaleAfterDays ?? DEFAULT_QUALITY_WARN_STALE_AFTER_DAYS
    this.minIdleHours = config.minIdleHours ?? DEFAULT_MIN_IDLE_HOURS
    this.excludeSkillNames = new Set(config.excludeSkillNames ?? [])
    this.manageUnmanaged = config.manageUnmanaged ?? false
    this.pruneBuiltins = config.pruneBuiltins ?? false
    this.referencedSkillNames = new Set(config.referencedSkillNames ?? [])
    this.bootGraceSeconds = config.bootGraceSeconds ?? 10
    this.curatorReviewMaxTokens = config.curatorReviewMaxTokens ?? 2048
    this.healthSoftBodyChars = config.healthSoftBodyChars ?? DEFAULT_HEALTH_THRESHOLDS.softBodyChars
    this.healthStampDensityPerKb = config.healthStampDensityPerKb ?? DEFAULT_HEALTH_THRESHOLDS.stampDensityPerKb
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
    // Catch-up check after the boot grace (restart with a due persisted state
    // must not wait a full interval; services mounting during boot must not
    // see a half-built host). The regular hourly tick keeps the schedule
    // running afterwards. Both fire autoCheck, which decides due-ness from
    // the persisted lastRunAt — the single durable truth across restarts.
    this.bootCheck = setTimeout(() => {
      this.bootCheck = undefined
      void this.autoCheck()
    }, this.bootGraceSeconds * 1000)
    this.bootCheck.unref()
    this.timer = setInterval(() => void this.autoCheck(), 60 * 60 * 1000)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (this.bootCheck) clearTimeout(this.bootCheck)
    this.bootCheck = undefined
  }

  /**
   * Pause or resume automatic curation (B-line G2, Hermes `set_paused`
   * parity): the flag is persisted on the curator state record and the
   * `run()` paused gate skips automatic passes while it holds. Manual runs
   * (`ignoreGates`) are unaffected — pause is a soft stop for the scheduler,
   * not a lock on the operator.
   *
   * Pausing on a state-less curator state seeds the record with `lastRunAt:
   * now`, so a later resume re-enters through the interval gate and defers a
   * full cycle instead of firing immediately (first-run defer interaction,
   * kept deliberately: an unattended resume must not auto-run mid-boot).
   */
  async setPaused(paused: boolean): Promise<void> {
    const stateService = this.curatorStateService()
    const persisted = (await stateService?.loadCuratorState()) ?? null
    await stateService?.saveCuratorState({
      schemaVersion: 1,
      lastRunAt: persisted?.lastRunAt ?? Date.now(),
      runCount: persisted?.runCount ?? 0,
      lastSummary: persisted?.lastSummary ?? (paused ? 'paused' : 'resumed'),
      paused,
    })
  }

  /** Current persisted curator state (read-only view for /evolution curator status). */
  async status(): Promise<CuratorStateRecordShape | null> {
    const service = this.curatorStateService()
    return (await service?.loadCuratorState()) ?? null
  }

  /**
   * One automatic schedule check: run a pass when the persisted curator state
   * (falling back to the in-memory clock for state-less compositions) is at
   * least one interval old. All gates — interval, idle, first-run defer,
   * reentrancy — stay inside `run()`, so this method only decides whether to
   * wake it, and never duplicates gate logic.
   */
  private async autoCheck(): Promise<void> {
    const persisted = await this.curatorStateService()?.loadCuratorState()
    const last = persisted?.lastRunAt ?? this.lastRun
    if (Date.now() - last >= this.lifecycle().intervalHours * 3_600_000) {
      await this.run()
    }
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
      }): AsyncIterable<StreamChunk>
    } | undefined
    if (!llm) return empty
    const policy = this.ctx.get('evolutionPolicy') as { get(): { curatorModel: string } } | undefined
    const model = policy?.get().curatorModel ?? 'deepseek-v4-pro'
    const clusters = computePrefixClusters(candidates)
    const clusterLines = clusters.length === 0
      ? ['Prefix clusters observed in the candidate list: (none)']
      : [
        'Prefix clusters observed in the candidate list (orientation only — verify against the names above; you may also flag additional clusters):',
        ...clusters.map(cluster => `- '${cluster.key}': ${cluster.members.join(', ')}`),
      ]
    const prompt = [
      options.dryRun ? CURATOR_DRY_RUN_BANNER : '',
      CURATOR_PROMPT,
      '',
      `Stale candidates observed by the deterministic lifecycle scanner:${candidates.length === 0 ? ' (none)' : ''}`,
      ...candidates.map(name => `- ${name}`),
      '',
      ...clusterLines,
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
      })) assembler.push(chunk)
      const text = assembler.blocks().filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text').map(block => block.text).join('\n')
      const parsed = parseCuratorNominations(text)
      return {
        prunings: parsed.prunings.filter(name => candidates.includes(name)),
        // M-1 (v3 audit): consolidations get the same pool filter as prunings —
        // a nomination whose source is NOT a known candidate has no executability
        // authority (the engine runs only names it presented to the model).
        consolidations: parsed.consolidations.filter(item => candidates.includes(item.from)),
      }
    } catch {
      // LLM curation is advisory. The deterministic scanner still owns the decision.
      return empty
    }
  }

  /** Optional curator-state service (evolution-state-json / storage-domain). */
  private curatorStateService(): {
    loadCuratorState(): Promise<{ lastRunAt: number; runCount: number; lastSummary: string; paused: boolean } | null>
    saveCuratorState(record: CuratorStateRecordShape): Promise<void>
  } | undefined {
    const service = this.ctx.get('evolutionState') as {
      loadCuratorState(): Promise<{ lastRunAt: number; runCount: number; lastSummary: string; paused: boolean } | null>
      saveCuratorState(record: CuratorStateRecordShape): Promise<void>
    } | undefined
    return service
  }

  /**
   * Full-state snapshot: the skills tree plus the current curator state as an
   * `extras/curator-state.json` side file. Every pre-mutation snapshot in the
   * curator goes through here so a later `restoreSnapshot()` can rewind both
   * the tree and the state (Hermes curator_backup backs up `.curator_state`).
   */
  async snapshotFull(reason = 'pre-mutation'): Promise<string> {
    const stateService = this.curatorStateService()
    const state = await stateService?.loadCuratorState()
    const extras = state === null || state === undefined
      ? []
      : [{ name: 'curator-state.json', content: JSON.stringify(state, null, 2) }]
    return await this.skills.snapshotAll(reason, extras)
  }

  /**
   * Full-state rollback: restore the latest snapshot's tree/sidecars/archive
   * AND the curator state it carried. The pre-rollback safety snapshot keeps
   * the current tree plus current state (as extras), so the rollback itself
   * is reversible.
   */
  async restoreSnapshot(): Promise<SkillActionResult & { extras?: Array<{ name: string; content: string }> }> {
    const stateService = this.curatorStateService()
    const currentState = await stateService?.loadCuratorState()
    const extras = currentState === null || currentState === undefined
      ? []
      : [{ name: 'curator-state.json', content: JSON.stringify(currentState, null, 2) }]
    const result = await this.skills.restoreLatestSnapshot(extras)
    if (!result.ok) return result
    const stateExtra = result.extras?.find(extra => extra.name === 'curator-state.json')
    if (stateExtra && stateService) {
      try {
        await stateService.saveCuratorState(JSON.parse(stateExtra.content) as CuratorStateRecordShape)
      } catch (error) {
        // The tree restore already landed; a failed state write must not turn
        // a completed rollback into an error — but it is observable.
        this.ctx.logger.warn(`evolution-curator: failed to restore curator state: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return result
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
   * Reentrant calls (autoStart timer + manual command at the same instant) are
   * skipped with an explicit `already-running` outcome.
   */
  async run(options: { ignoreGates?: boolean; dryRun?: boolean } = {}): Promise<CuratorRunOutcome> {
    if (this.running) {
      return {
        stale: [], archived: [], errors: [],
        report: this.skippedReport('already-running', new Date().toISOString()),
        skipped: 'already-running',
      }
    }
    this.running = true
    try {
      return await this.runCore(options)
    } finally {
      this.running = false
    }
  }

  private async runCore(options: { ignoreGates?: boolean; dryRun?: boolean } = {}): Promise<CuratorRunOutcome> {
    const { ignoreGates = false, dryRun = false } = options
    const startedAt = new Date().toISOString()
    const runId = randomUUID()
    const stateService = this.curatorStateService()
    const lifecycle = this.lifecycle()
    // Normalize "no state service" onto "no persisted state" (rc.42 audit
    // P1-7): with the service missing, `persisted` used to stay undefined, the
    // first-run defer never fired (`persisted === null`) and the interval gate
    // compared NaN — the curator ran immediately on a fresh install.
    const persisted = (await stateService?.loadCuratorState()) ?? null
    // Paused gate (B-line G2, Hermes `should_run_now` order: enabled → paused →
    // interval): an operator pause is a soft stop for AUTOMATIC passes only —
    // `ignoreGates` (the manual /evolution curator run semantics) still executes.
    if (!ignoreGates && persisted?.paused === true) {
      return {
        stale: [], archived: [], errors: [],
        report: this.skippedReport(runId, startedAt),
        skipped: 'paused',
      }
    }
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
    const snapshotPath = dryRun ? undefined : await this.snapshotFull('pre-curator-run')
    const suppressedNames = new Set(await loadSuppressedNames(root, this.io))
    // One GateSet instance per run (decision B) shared by the lifecycle
    // engine and the merge-nomination gate below.
    const gates = new EvolutionGateSet({
      exclude: this.excludeSkillNames,
      referenced: this.referencedSkillNames,
      suppressed: suppressedNames,
    })
    const { bundledNames, treeNames } = await this.seedBaseline(usage)
    // P2-5: near-duplicate groups join the recommendation candidate pool —
    // the deterministic scanner sees idle names, only the LLM sees overlap.
    const contents = new Map<string, string>()
    for (const name of treeNames) {
      const text = await this.skills.read(name)
      if (text) contents.set(name, text)
    }
    const dedupMembers = [...new Set(
      computeDedupGroups({ contents }).filter(group => group.length >= 2).flat(),
    )]
    // Score BEFORE the lifecycle transitions (rc.42 audit P1-2): the transition
    // engine reads `quality_warn` to apply the shorter quality-warn stale
    // window, so it must see THIS run's freshly computed scores — the old
    // order (transitions → scoring) applied last run's warn state and delayed
    // the quality-warn stale path by a full curator cycle.
    await this.scoreTree(usage, treeNames)
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
    }, new Date(), gates)
    const recommendPool = [...new Set([...result.markStale, ...dedupMembers])]
    const nominations = this.llmReview
      ? await this.recommend(recommendPool, { dryRun })
      : { prunings: [], consolidations: [] }
    // Automatic merge nominations must pass the same gates as the control
    // plane: excluded/referenced/suppressed skills are never merged (source
    // or target), even when the LLM nominates them. Prunings additionally
    // keep the deterministic stale pool only (M-3, v3 audit): the dedup
    // members joined the pool for CONSOLIDATION inputs, not for pruning —
    // an active, non-stale skill must never be archivable via LLM nomination.
    const gatedNominations = {
      ...nominations,
      prunings: nominations.prunings.filter(name => result.markStale.includes(name)),
      consolidations: gateConsolidations(nominations.consolidations, gates),
    }
    const llmNominations = gatedNominations.prunings
    const archiveCandidates = [...new Set([...result.archive, ...llmNominations])]
    const { archivedSkills, errors, consolidated } = await this.applyMutations({
      dryRun,
      archiveCandidates,
      nominations: gatedNominations,
      treeNames,
      usage,
      bundledNames,
      suppressedNames,
      root,
      recommendPool: new Set(recommendPool),
      // rc.72 H-1: the lifecycle pair folds only for names this run changed —
      // the transitions engine mutates the snapshot (state='stale'/'archived'/
      // 'active'), and a concurrent curator run's archive/restore must never be
      // reverted by a stale snapshot.
      stateOwned: new Set([...result.transitions.map(t => t.name), ...archiveCandidates]),
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
      consolidated,
      ...snapshotPath === undefined ? {} : { snapshotPath },
      llmReviewEnabled: this.llmReview,
    })
    const reportsRoot = join(evolutionHome(), 'reports')
    try {
      await this.io.writeText(join(reportsRoot, `curator-${runId}.json`), JSON.stringify(report, null, 2))
      // Human-readable digest alongside the JSON (G6); pruned with the same
      // retention pass below.
      await this.io.writeText(join(reportsRoot, `curator-${runId}.md`), renderCuratorReportMarkdown(report))
      await this.retainReports(20)
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
    // Preserve an operator pause (rc.43 G2 regression fix): the paused gate
    // read `persisted` at run start, but the operator may pause while this
    // pass is in flight — and a manual run is ALLOWED while paused. Either
    // way the run's bookkeeping write must not clear the flag, so the current
    // value is re-read at save time instead of the stale run-start snapshot.
    const pausedNow = (await stateService?.loadCuratorState())?.paused ?? false
    await stateService?.saveCuratorState({
      schemaVersion: 1,
      // A dry-run is a preview: it must not push the next scheduled pass out.
      lastRunAt: dryRun ? (persisted?.lastRunAt ?? this.lastRun) : this.lastRun,
      runCount: dryRun ? (persisted?.runCount ?? 0) : (persisted?.runCount ?? 0) + 1,
      lastSummary: summary,
      paused: pausedNow,
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
      // Single-source parsing (G3): identical semantics to the former inline
      // scan, plus dedupe — one referrer counts once per target no matter how
      // often it repeats in the list.
      for (const target of relatedSkillNames(content, name)) {
        counts.set(target, (counts.get(target) ?? 0) + 1)
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
    /** The exact candidate pool this run presented to the LLM (M-1 hard backstop). */
    recommendPool: Set<string>
    /** Names this run actually transitioned (rc.72 H-1 lifecycle ownership). */
    stateOwned?: ReadonlySet<string>
  }): Promise<{
    archivedSkills: Array<{ name: string; path: string; reason: string }>
    errors: string[]
    suppressedChanged: boolean
    consolidated: CuratorConsolidation[]
  }> {
    if (input.dryRun) return { archivedSkills: [], errors: [], suppressedChanged: false, consolidated: [] }
    const { archiveCandidates, nominations, treeNames, usage, bundledNames, suppressedNames, root, failedFrom } = input
    const errors: string[] = []
    const archivedSkills: Array<{ name: string; path: string; reason: string }> = []
    const executedConsolidations: CuratorConsolidation[] = []
    let suppressedChanged = false
    // Delta set (rc.52 regression review): the save below must merge only the
    // names THIS run added — a full-set union would resurrect a suppression a
    // concurrent restore deleted between our load and our save.
    const suppressedAdded = new Set<string>()
    // rc.72 H-1: the lifecycle pair is folded only for names this run actually
    // transitioned (transitions engine + success/rollback archive writes +
    // consolidation sources) — a concurrent curator run's archive/restore must
    // never be reverted by this run's stale snapshot.
    const stateOwned = new Set(input.stateOwned ?? [])
    for (const name of archiveCandidates) {
      const archived = await this.skills.archive(name, { reason: 'Lifecycle: reached archive threshold', allowBundled: this.pruneBuiltins })
      if (!archived.ok) {
        // A failed archive must roll back to the pre-transition state: a
        // stale->archived failure that left state='archived' would silently
        // drop the stale flag and cause a stale->active->stale oscillation.
        const record = usage.get(name)
        const from = failedFrom?.get(name)
        // P3 (v3 audit): the pre-transition state write also cleared the
        // archive timestamp — rollback must undo BOTH fields or the record
        // reads as 'active' with a non-null archived_at (record invariant).
        if (record && (from === 'stale' || from === 'active')) {
          record.state = from
          record.archived_at = null
          stateOwned.add(name)
        }
        errors.push(`${name}: ${archived.message}`)
      } else {
        // Uniform state transition for EVERY successful archive — deterministic
        // candidates were pre-set by computeLifecycleTransitions, but LLM
        // nominations were not; without this the next run re-archives a missing
        // directory and errors forever.
        const record = usage.get(name)
        if (record) {
          record.state = 'archived'
          record.archived_at = new Date().toISOString()
          stateOwned.add(name)
        }
        archivedSkills.push({ name, path: archived.path ?? '', reason: 'Lifecycle: reached archive threshold' })
        if (bundledNames.has(name)) {
          suppressedNames.add(name)
          suppressedAdded.add(name)
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
      // M-1 hard backstop: a source outside this run's candidate pool has no
      // executability authority (the model may have narrated an action it did
      // not take). Skip visibly, never silently.
      if (!input.recommendPool.has(nomination.from)) {
        errors.push(`${nomination.from}: consolidation nomination outside the candidate pool — refused (advisory text has no executability authority)`)
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
        stateOwned.add(nomination.from)
      }
      alreadyArchived.add(nomination.from)
      executedConsolidations.push({ from: nomination.from, into: nomination.into })
      // Approximate recovered location: the exact archive dir may carry a
      // stamp suffix, but consolidated.path points at the TARGET, not the
      // archived source, so it must not be reported as the source's path.
      archivedSkills.push({ name: nomination.from, path: join(this.skills.root, '.archive', nomination.from), reason: `Consolidated into ${nomination.into}` })
    }
    if (suppressedChanged) {
      try {
        // Atomic RMW (rc.50 P2-2): merge only this run's ADDITIONS into the
        // current on-disk set inside one transact — a second process's
        // additions are preserved and its deletions are not re-added.
        await updateSuppressedNames(root, this.io, (current) => {
          for (const name of suppressedAdded) current.add(name)
        })
      } catch {
        // Best-effort like the report write: a transient disk failure must not
        // make a run that already archived skills throw after the fact.
        this.ctx.logger.warn('evolution-curator: failed to persist suppressed names; archived built-ins may re-enter the lifecycle')
      }
    }
    try {
      // rc.67 K-1/K-2: the curator folds its authoritative records through the
      // same transact-backed mutateUsage the tool side uses, at FIELD
      // granularity — a whole-record set would clobber a concurrent tool-side
      // counter bump between the run-start load and this save.
      await mutateUsage(root, this.io, (disk) => { foldCuratorFields(disk, usage, stateOwned) })
    } catch {
      // Best-effort: curation decisions already landed; a failed usage flush
      // must not surface as a run error after the fact.
      this.ctx.logger.warn('evolution-curator: failed to persist usage sidecar')
    }
    // The registry caches the sidecar in-process; the curator wrote it directly
    // above, so the next tool telemetry flush must re-read instead of re-covering
    // the quality/state/pinned changes with its stale cache.
    const usageRegistry = this.ctx.get('skillUsage') as { invalidate?(): Promise<void> } | undefined
    try {
      await usageRegistry?.invalidate?.()
    } catch {
      // Best-effort like the flush above.
    }
    return { archivedSkills, errors, suppressedChanged, consolidated: executedConsolidations }
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

  /**
   * Keep only the newest N curator reports, ordered by the report's own
   * `startedAt` (the runId is a UUID and cannot order history). Best-effort
   * like `retainSnapshots`: a failed removal must not fail the run that just
   * persisted its report. The paired `.md` digest is pruned with its JSON.
   */
  private async retainReports(keep: number): Promise<void> {
    const reportsRoot = join(evolutionHome(), 'reports')
    let entries: string[]
    try {
      entries = await this.io.list(reportsRoot)
    } catch {
      return
    }
    const dated: Array<{ name: string; startedAt: number }> = []
    for (const name of entries.filter(entry => entry.startsWith('curator-') && entry.endsWith('.json'))) {
      try {
        const raw = await this.io.readText(join(reportsRoot, name))
        if (raw === null) continue
        const parsed = JSON.parse(raw) as { startedAt?: string }
        const startedAt = typeof parsed.startedAt === 'string' ? Date.parse(parsed.startedAt) : Number.NaN
        if (Number.isFinite(startedAt)) dated.push({ name, startedAt })
      } catch {
        // Unclassifiable report: keep it — never delete what we cannot order.
      }
    }
    dated.sort((a, b) => b.startedAt - a.startedAt)
    for (const oldReport of dated.slice(keep)) {
      const stem = oldReport.name.replace(/\.json$/, '')
      try {
        await this.io.remove(join(reportsRoot, oldReport.name))
      } catch {
        // Best-effort pruning.
      }
      try {
        await this.io.remove(join(reportsRoot, `${stem}.md`))
      } catch {
        // The digest may already be gone (or never existed); keep going.
      }
    }
  }

  async latestReport(): Promise<CuratorRunReport | null> {
    const reportsRoot = join(evolutionHome(), 'reports')
    const names = (await this.io.list(reportsRoot)).filter(name => name.startsWith('curator-') && name.endsWith('.json')).sort()
    // v3-round self-check: filenames carry randomUUIDs — lexicographic order
    // is NOT chronological. Read each report's own startedAt (retention keeps 20).
    let latest: { name: string; startedAt: number } | null = null
    for (const name of names) {
      const raw = await this.io.readText(join(reportsRoot, name))
      if (raw === null) continue
      try {
        const parsed = JSON.parse(raw) as { startedAt?: string }
        const startedAt = typeof parsed.startedAt === 'string' ? Date.parse(parsed.startedAt) : 0
        if (!Number.isFinite(startedAt)) continue
        if (latest === null || startedAt > latest.startedAt) latest = { name, startedAt }
      } catch {
        // Unreadable reports are skipped (retention refuses to classify them too).
      }
    }
    if (latest === null) return null
    const raw = await this.io.readText(join(reportsRoot, latest.name))
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
    const gates = new EvolutionGateSet({
      exclude: this.excludeSkillNames,
      referenced: this.referencedSkillNames,
      suppressed: new Set(await loadSuppressedNames(root, this.io)),
    })
    return computeScopeView(usage, {
      staleAfterDays: this.lifecycle().staleAfterDays,
      archiveAfterDays: this.lifecycle().archiveAfterDays,
      excludeSkillNames: this.excludeSkillNames,
      referencedSkillNames: this.referencedSkillNames,
      suppressedNames: new Set(gates.suppressed),
      manageUnmanaged: this.manageUnmanaged,
      pruneBuiltins: this.pruneBuiltins,
      bundledNames,
    }, await this.protectedNameMap(), gates)
  }

  /**
   * Structure-health view (rc.73 A1, 008 design): degraded skills only,
   * derived on demand — never persisted. Signals for review/curate proposals;
   * the deterministic assessment stays here, refinement stays in the judgment
   * layer.
   */
  async healthView(): Promise<Array<{ name: string; verdict: SkillHealthVerdict; reasons: string[] }>> {
    const thresholds = { softBodyChars: this.healthSoftBodyChars, stampDensityPerKb: this.healthStampDensityPerKb }
    const rows: Array<{ name: string; verdict: SkillHealthVerdict; reasons: string[] }> = []
    for (const summary of await this.skills.list()) {
      const assessment = await this.skills.assessHealth(summary.name, thresholds)
      if (assessment && assessment.verdict !== 'healthy') rows.push({ name: summary.name, verdict: assessment.verdict, reasons: assessment.reasons })
    }
    return rows
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
    // Control-plane gate (rc.42 audit P1-8): the manual path once checked
    // only excludeSkillNames, bypassing the referenced/suppressed/protected
    // protections the automated nomination gate enforces. The same GateSet
    // answers for both directions now.
    const suppressedNames = new Set(await loadSuppressedNames(this.skills.root, this.io))
    const gates = new EvolutionGateSet({
      exclude: this.excludeSkillNames,
      referenced: this.referencedSkillNames,
      suppressed: suppressedNames,
    })
    const blocked = [...new Set([target, ...sources])].filter(name => gates.isBlocked(name))
    if (blocked.length > 0) {
      return { ok: false, message: `Skill(s) protected from consolidation (excluded / referenced / suppressed / protected builtin): ${blocked.join(', ')}` }
    }
    await this.snapshotFull('pre-consolidate')
    const result = await this.skills.consolidate(target, sources)
    if (!result.ok) return result
    // rc.67 K-1: the control plane folds through the same transact-backed RMW
    // as the automated path — a whole-file saveUsage here would clobber a
    // concurrent tool-side bump and would flatten a malformed sidecar to empty.
    await mutateUsage(this.skills.root, this.io, (disk) => {
      for (const source of sources) {
        const record = disk.get(source)
        if (record) {
          record.state = 'archived'
          record.archived_at = new Date().toISOString()
        }
      }
    })
    return result
  }

  /**
   * Control-plane restore: bring one archived skill back to the active root
   * and reset its usage state, keeping the recoverable-archive invariant.
   */
  async restore(name: string): Promise<SkillActionResult> {
    await this.snapshotFull('pre-restore')
    const result = await this.skills.restoreFromArchive(name)
    if (!result.ok) return result
    // rc.67 K-1: same transact-backed, malformed-safe fold as consolidate.
    await mutateUsage(this.skills.root, this.io, (disk) => {
      const record = disk.get(name)
      if (record) {
        record.state = 'active'
        record.archived_at = null
      }
    })
    const suppressed = new Set(await loadSuppressedNames(this.skills.root, this.io))
    if (suppressed.has(name)) {
      try {
        // Atomic RMW (rc.50 P2-2): delete only inside the transact so a
        // concurrent process's suppression additions survive the restore.
        await updateSuppressedNames(this.skills.root, this.io, (current) => {
          current.delete(name)
        })
      } catch {
        // The restore itself already landed; suppression cleanup is best-effort.
        this.ctx.logger.warn(`evolution-curator: failed to persist suppressed names after restoring ${name}`)
      }
    }
    return result
  }
}

export default EvolutionCurator
