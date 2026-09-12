/**
 * Deterministic skill lifecycle curator with interval gate and archive.
 * @module @deepseek-ai/dsh-evolution-curator
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import { CuratorArchivedSkill, EvolutionGateSet, evolutionIoAdapter, markerEntryName, relatedSkillNames, SkillLibrary, SKILL_NAME_RE, resolveSkillsRoot, DEFAULT_CURATOR_BOOT_GRACE_SECONDS, DEFAULT_CURATOR_REVIEW_MAX_TOKENS } from '@deepseek-ai/dsh-evolution-core'
import { foldCuratorFields, loadUsage, mutateUsage, type UsageMap } from '@deepseek-ai/dsh-evolution-core'
import { emptyRecord, loadSuppressedNames, updateSuppressedNames } from '@deepseek-ai/dsh-evolution-core'
import { DEFAULT_CURATOR_MODEL, MAX_TIMER_DELAY_MS, usageObserved } from '@deepseek-ai/dsh-evolution-core'
import { computeDedupGroups, buildCuratorRunReport, computeLifecycleTransitions, computePrefixClusters, computeQualityScores, computeScopeView, parseCuratorNominations, parseFrontmatter, renderCuratorReportMarkdown, type CuratorConsolidation, type CuratorNominations, type CuratorRunReport, type ScopeView, type SkillActionResult, type SkillHealthVerdict } from '@deepseek-ai/dsh-evolution-core'
import { evolutionHome, DEFAULT_CURATOR_INTERVAL_HOURS, DEFAULT_HEALTH_THRESHOLDS, DEFAULT_MIN_IDLE_HOURS, DEFAULT_STALE_AFTER_DAYS, DEFAULT_ARCHIVE_AFTER_DAYS, clampedNumber } from '@deepseek-ai/dsh-evolution-core'
import { CURATOR_PROMPT, CURATOR_DRY_RUN_BANNER } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { SkillHealthThresholds } from '@deepseek-ai/dsh-evolution-core'
import type { CuratorStateRecord } from '@deepseek-ai/dsh-evolution-state'


/** Quality-warned skills may turn stale after this many idle days (package-private tunable, P2-8). */

const DEFAULT_QUALITY_WARN_STALE_AFTER_DAYS = 7

/** B-10 (v18): the optional LLM nomination pass gets its own timeout so a
 * hung/unresponsive provider cannot hold the control-plane mutex forever
 * (`run()` never returns; `restore()`/`consolidate()` queue behind it).
 * 120s matches the review subagent default; the 32-bit ceiling is Node's
 * timer-delay limit (`AbortSignal.timeout` throws above it). */
const DEFAULT_CURATOR_REVIEW_TIMEOUT_MS = 120_000
// V27 G2.4: the timer ceiling is the core protocol constant (was a local copy).



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
  /** Skill-tree root for curator scope/snapshot/archive (D2, v11) — a custom
   * root deployment (review/tool-skill-manage write another tree) must point
   * the curator at the SAME tree or lifecycle decisions land on the default
   * tree and never see the deployed skills. Empty uses skillsRoot(). */
  root?: string
  /** Spend one LLM review pass on stale candidates before the deterministic archive step. */
  llmReview?: boolean
  curatorProvider?: string
  /** Quality-warned skills may turn stale after this many idle days. */
  qualityWarnStaleAfterDays?: number
  /** Skip automatic runs while any session was active within this many hours (0 disables). */
  minIdleHours?: number
  /** When true (default), a missing `agents` service is treated as "no active
   * session" (fail-open — the idle gate lets the run proceed); when false the
   * gate fails closed and defers the run until activity can be measured. */
  minIdleFailOpen?: boolean
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
  /** Timeout (ms) for the optional LLM nomination pass (B-10, v18). */
  curatorReviewTimeoutMs?: number
  /** Structure-health soft body limit (chars) — see DEFAULT_HEALTH_THRESHOLDS (rc.73 A1). */
  healthSoftBodyChars?: number
  /** Structure-health stamp-density ceiling per KB — see DEFAULT_HEALTH_THRESHOLDS. */
  healthStampDensityPerKb?: number
  /** Structure-health write-ghost floor: patches at/above with zero reads (A2). */
  healthChurnMinPatches?: number
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

/**
 * Persisted curator-state record. The base fields are the authoritative
 * `CuratorStateRecord` from evolution-state-storage; `schemaVersion` is an
 * optional on-disk shape marker the storage seam leaves untyped (kept for
 * legacy reads — 0.3.18, E-53).
 */
export type CuratorStateRecordShape = CuratorStateRecord & { schemaVersion?: number }

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
  // P3 (v15, verification pending): this gate covers marker/name protection for
  // BOTH directions, but the merge-executor's own marker check is the last
  // line of defence for `into` — `SkillLibrary.consolidate` calls
  // `writeProtection(targetName)` (see skill-store.ts consolidate) and refuses
  // pinned/bundled targets on its own. If that ever stops holding, this is
  // where a `into` marker pre-filter must be added.
  const gateSet = gates instanceof EvolutionGateSet ? gates : new EvolutionGateSet(gates)
  return consolidations.filter(n => !gateSet.isBlocked(n.from) && !gateSet.isBlocked(n.into))
}

export class EvolutionCurator extends Service {
  static inject = ['evolutionIo']
  static Config: Schema<Config> = z.object({
    // N6 (v12): `root` was declared on the interface and consumed by the
    // constructor (D2) but missing from the schema — schema-driven surfaces
    // (doc generation, config guard rails) could not see it.
    root: z.string().default(''),
    enabled: z.boolean().default(true),
    intervalHours: z.number().min(1).default(DEFAULT_CURATOR_INTERVAL_HOURS),
    staleAfterDays: z.number().min(1).default(DEFAULT_STALE_AFTER_DAYS),
    archiveAfterDays: z.number().min(1).default(DEFAULT_ARCHIVE_AFTER_DAYS),
    llmReview: z.boolean().default(false),
    curatorProvider: z.string().default('deepseek-official'),
    qualityWarnStaleAfterDays: z.number().min(1).default(DEFAULT_QUALITY_WARN_STALE_AFTER_DAYS),
    // minIdleHours 0 is a legitimate "no idle gate" (the gate guard is `> 0`),
    // so its min is 0; negative values are rejected.
    minIdleHours: z.number().min(0).default(DEFAULT_MIN_IDLE_HOURS),
    minIdleFailOpen: z.boolean().default(true),
    excludeSkillNames: z.array(z.string()).default([]),
    manageUnmanaged: z.boolean().default(false),
    pruneBuiltins: z.boolean().default(false),
    referencedSkillNames: z.array(z.string()).default([]),
    autoStart: z.boolean().default(true),
    // bootGraceSeconds 0 is a legitimate "no grace" (setTimeout(0)); negative
    // values are rejected. C2 (v15): the 32-bit setTimeout ceiling is enforced
    // at the ASSEMBLY clamp (`field(..., max)`) — the schema stays min-only so
    // NaN/±Infinity keep passing through to the clamp (G3.1 doctrine), while a
    // valid-but-huge number falls back to the default instead of arming a
    // timer Node would fire immediately.
    bootGraceSeconds: z.number().min(0).default(DEFAULT_CURATOR_BOOT_GRACE_SECONDS),
    curatorReviewMaxTokens: z.number().min(1).default(DEFAULT_CURATOR_REVIEW_MAX_TOKENS),
    curatorReviewTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_CURATOR_REVIEW_TIMEOUT_MS),
    healthSoftBodyChars: z.number().min(1).default(DEFAULT_HEALTH_THRESHOLDS.softBodyChars),
    healthStampDensityPerKb: z.number().min(1).default(DEFAULT_HEALTH_THRESHOLDS.stampDensityPerKb),
    healthChurnMinPatches: z.number().min(1).default(DEFAULT_HEALTH_THRESHOLDS.churnMinPatches),
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
  private readonly minIdleFailOpen: boolean
  private readonly excludeSkillNames: ReadonlySet<string>
  private readonly manageUnmanaged: boolean
  private readonly pruneBuiltins: boolean
  private readonly referencedSkillNames: ReadonlySet<string>
  private readonly bootGraceSeconds: number
  private readonly curatorReviewMaxTokens: number
  private readonly curatorReviewTimeoutMs: number
  private readonly healthSoftBodyChars: number
  private readonly healthStampDensityPerKb: number
  private readonly healthChurnMinPatches: number
  private lastRun = 0
  private timer: NodeJS.Timeout | undefined
  /** B-8 (v18): set by the fiber disposer; a triggered autoCheck must not
   * keep mutating the tree after the plugin was disposed. */
  private disposed = false

  /** B-8 (v18): read the disposal flag through a method. The only assignment
   * lives in the disposer closure, which TypeScript's flow analysis cannot
   * see, so a direct `this.disposed` read narrows to the literal `false` and
   * the runtime check would be reported as dead code by `no-unnecessary-condition`. */
  private isDisposed(): boolean {
    return this.disposed
  }
  private bootCheck: NodeJS.Timeout | undefined
  /** 0.3.18 (E-18): stateless first-run defer fires ONCE per process — the
   * in-memory clock is seeded and later due runs must proceed, or the
   * persisted===null defer repeats forever (no state service to persist). */
  private statelessFirstRunDeferred = false
  /** P2-5 (v14): one-shot warning that the interval baseline is process-only. */
  private statelessStateWarned = false

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionCurator')
    this.io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
    this.skills = new SkillLibrary(resolveSkillsRoot({ root: config.root }), this.io, undefined, (event) => { this.ctx.emit('evolution/skill-mutated', event) })
    this.enabled = config.enabled ?? true
    // G3.1 (0.3.23): numeric config is clamped at assembly so a 0/negative/NaN/
    // ±Infinity value falls back to the package default instead of folding as a
    // "disabled" special value (a 0 interval/stale/archive flag would transition
    // everything; NaN folds as NaN into a comparison). The schema `.min()`/`.min(0)`
    // guards the loader path; this clamp also covers NaN/±Infinity (which
    // schemastery lets through) and direct construction. `minIdleHours` and
    // `bootGraceSeconds` legitimately allow 0; every other numeric field clamps
    // to at least 1. Warn once when a user-supplied value had to be corrected.
    const clamped: string[] = []
    const field = (name: string, value: number | undefined, fallback: number, min: number, max?: number): number => {
      const result = clampedNumber(value, fallback, max === undefined ? { min } : { min, max })
      if (value !== undefined && result !== value) clamped.push(name)
      return result
    }
    this.intervalHours = field('intervalHours', config.intervalHours, DEFAULT_CURATOR_INTERVAL_HOURS, 1)
    this.staleAfterDays = field('staleAfterDays', config.staleAfterDays, DEFAULT_STALE_AFTER_DAYS, 1)
    this.archiveAfterDays = field('archiveAfterDays', config.archiveAfterDays, DEFAULT_ARCHIVE_AFTER_DAYS, 1)
    // A2-17 (v18): a stale threshold above the archive threshold makes the
    // engine reactivate stale records instead of archiving them. Clamp the
    // archive window up to the stale window and say so.
    if (this.archiveAfterDays < this.staleAfterDays) {
      this.ctx.logger.warn(`evolution-curator: archiveAfterDays (${this.archiveAfterDays}) < staleAfterDays (${this.staleAfterDays}); using staleAfterDays as the archive threshold`)
      this.archiveAfterDays = this.staleAfterDays
    }
    this.llmReview = config.llmReview ?? false
    this.curatorProvider = config.curatorProvider ?? 'deepseek-official'
    this.qualityWarnStaleAfterDays = field('qualityWarnStaleAfterDays', config.qualityWarnStaleAfterDays, DEFAULT_QUALITY_WARN_STALE_AFTER_DAYS, 1)
    this.minIdleHours = field('minIdleHours', config.minIdleHours, DEFAULT_MIN_IDLE_HOURS, 0)
    this.minIdleFailOpen = config.minIdleFailOpen ?? true
    this.excludeSkillNames = new Set(config.excludeSkillNames ?? [])
    this.manageUnmanaged = config.manageUnmanaged ?? false
    this.pruneBuiltins = config.pruneBuiltins ?? false
    this.referencedSkillNames = new Set(config.referencedSkillNames ?? [])
    this.bootGraceSeconds = field('bootGraceSeconds', config.bootGraceSeconds, DEFAULT_CURATOR_BOOT_GRACE_SECONDS, 0, 3600)
    this.curatorReviewMaxTokens = field('curatorReviewMaxTokens', config.curatorReviewMaxTokens, DEFAULT_CURATOR_REVIEW_MAX_TOKENS, 1)
    this.curatorReviewTimeoutMs = field('curatorReviewTimeoutMs', config.curatorReviewTimeoutMs, DEFAULT_CURATOR_REVIEW_TIMEOUT_MS, 1, MAX_TIMER_DELAY_MS)
    this.healthSoftBodyChars = field('healthSoftBodyChars', config.healthSoftBodyChars, DEFAULT_HEALTH_THRESHOLDS.softBodyChars, 1)
    this.healthStampDensityPerKb = field('healthStampDensityPerKb', config.healthStampDensityPerKb, DEFAULT_HEALTH_THRESHOLDS.stampDensityPerKb, 1)
    this.healthChurnMinPatches = field('healthChurnMinPatches', config.healthChurnMinPatches, DEFAULT_HEALTH_THRESHOLDS.churnMinPatches, 1)
    if (clamped.length > 0) {
      this.ctx.logger.warn(`evolution-curator: ${clamped.join(', ')} provided an invalid value; falling back to the default`)
    }
    this.lastRun = Date.now()
    this.ctx.effect(() => {
      return () => {
        this.disposed = true
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
    if (this.isDisposed() || !this.enabled || this.timer) return
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
    // H-07: a state-less composition previously fell through the
    // optional chain silently — the pause LOOKED successful (the command
    // surface reports success) but nothing was persisted, and the very next
    // auto-check ran as if never paused. Declare the loss on the logger: the
    // pause is NOT persisted and will not survive the process.
    if (!stateService) {
      this.ctx.logger.warn('evolution-curator: curator state service absent; pause not persisted')
      return
    }
    // E-16 (S5.5): one atomic read-modify-write instead of the previous
    // load→save pair, so a concurrent run-core bookkeeping write can never
    // interleave a stale load with a newer save (or vice versa).
    await stateService.transactCuratorState(current => ({
      schemaVersion: 1,
      lastRunAt: current?.lastRunAt ?? Date.now(),
      runCount: current?.runCount ?? 0,
      lastSummary: current?.lastSummary ?? (paused ? 'paused' : 'resumed'),
      paused,
    }))
  }

  /** Current persisted curator state (read-only view for /evolution curator status). */
  async status(): Promise<CuratorStateRecordShape | null> {
    const service = this.curatorStateService()
    return (await service?.loadCuratorState()) ?? null
  }

  /**
   * One automatic schedule check. P2-11 (v11): the interval gate is exercised
   * HERE as a cheap pre-check (persisted or in-memory clock) AND again inside
   * run() as the authoritative gate — the docstring no longer claims the two
   * never duplicate; a future interval change must update both.
   *
   * P2-5 (v14): without the `evolution-state` service there is no durable
   * `lastRunAt`, so the baseline degrades to this process's lifetime. That is
   * a supported-but-degraded composition (every shipped bundle mounts the
   * state rows), so the schedule is left as-is and the degradation is
   * surfaced once instead of silently meaning "never runs".
   */
  private async autoCheck(): Promise<void> {
    if (this.isDisposed()) return
    // 0.3.18 (E-7): the unattended tick (boot catch-up / hourly interval) must
    // be self-contained — a transient filesystem error (Windows EBUSY/EPERM,
    // lock contention) inside loadCuratorState/run used to surface as an
    // unhandled rejection and crash the host. Catch, log, persist a failed
    // report (leave a trace), never propagate.
    try {
      const stateService = this.curatorStateService()
      if (stateService === undefined && !this.statelessStateWarned) {
        this.statelessStateWarned = true
        this.ctx.logger.warn(`evolution-curator: evolution-state is not mounted — the curation interval baseline is this process's lifetime only (default interval ${DEFAULT_CURATOR_INTERVAL_HOURS}h), so automatic curation will not fire again until the process has been alive that long. Mount evolution-state (evolution-host/all bundle) for a durable schedule.`)
      }
      const persisted = await stateService?.loadCuratorState()
      if (this.isDisposed()) return
      const last = persisted?.lastRunAt ?? this.lastRun
      if (Date.now() - last >= this.lifecycle().intervalHours * 3_600_000) {
        await this.run()
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`evolution-curator: automatic check failed: ${reason}`)
      try {
        const runId = randomUUID()
        await this.io.writeText(
          join(evolutionHome(), 'reports', `curator-error-${runId}.json`),
          JSON.stringify({ runId, failed: true, error: reason, at: new Date().toISOString() }, null, 2),
        )
      } catch (persistenceError) {
        this.ctx.logger.warn(`evolution-curator: failed to persist auto-check error report: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`)
      }
      // V4-22: a failing auto-check writes an error report AND must recycle
      // history — otherwise a persistently throwing host accumulates
      // curator-error-*.json unbounded (retention used to run only on success).
      // V5-22: this is the one unprotected call in the recovery path — a
      // provider that throws here (malformed reports listing) must stay
      // observable and NOT become an unhandled rejection (the persistence
      // path above wraps the same class of failure).
      try {
        await this.retainReports()
      } catch (retentionError) {
        this.ctx.logger.warn(`evolution-curator: failed to recycle auto-check error reports: ${retentionError instanceof Error ? retentionError.message : String(retentionError)}`)
      }
    }
  }

  /**
   * Optional Hermes-curator LLM pass. The model may only NOMINATE pruning and
   * consolidation; every move stays a control-plane operation and each
   * nomination is re-validated against the tree and protected markers before
   * any file move. `dryRun` prepends the report-only banner.
   */
  async recommend(candidates: string[], options: { dryRun?: boolean } = {}): Promise<CuratorNominations> {
    const empty: CuratorNominations = { prunings: [], consolidations: [], warnings: [] }
    if (candidates.length === 0) return empty
    // P2-13 (v15): consume the REAL upstream type instead of a hand-written
    // structural cast — an upstream field rename/signature drift now fails
    // `tsc` at the mirror instead of breaking at runtime after an upgrade.
    // The hand-written shape was: { stream(options: { provider; model;
    // messages: unknown[]; maxTokens }) }.
    const llm = this.ctx.get('llm')
    if (!llm) return empty
    const policy = this.ctx.get('evolutionPolicy') as { get(): { curatorModel: string } | undefined } | undefined
    const model = policy?.get()?.curatorModel ?? DEFAULT_CURATOR_MODEL
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
      'Stale candidates observed by the deterministic lifecycle scanner:',
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
        // B-10 (v18): a hung provider must not hold the control-plane mutex
        // forever; the abort lands in the existing catch (advisory empty
        // nominations), and the run/restore/consolidate chain continues.
        signal: AbortSignal.timeout(this.curatorReviewTimeoutMs),
      })) assembler.push(chunk)
      const text = assembler.blocks().filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text').map(block => block.text).join('\n')
      const parsed = parseCuratorNominations(text)
      return {
        prunings: parsed.prunings.filter(name => candidates.includes(name)),
        // M-1 (v3 audit): consolidations get the same pool filter as prunings —
        // a nomination whose source is NOT a known candidate has no executability
        // authority (the engine runs only names it presented to the model).
        consolidations: parsed.consolidations.filter(item => candidates.includes(item.from)),
        // V6-35 (0.3.36): lenient-parse shape notes flow into the run report —
        // a dropped `mode:` or a section flip stays visible to the operator.
        warnings: parsed.warnings,
      }
    } catch (error) {
      // LLM curation is advisory. The deterministic scanner still owns the
      // decision — but the swallow must be observable (E-52): a silent catch
      // once hid a whole-channel failure behind an empty nomination set.
      this.ctx.logger.warn(`evolution-curator: LLM nomination pass failed: ${error instanceof Error ? error.message : String(error)}`)
      return empty
    }
  }

  /** Optional curator-state service (evolution-state-json / storage-domain). */
  private curatorStateService(): {
    loadCuratorState(): Promise<CuratorStateRecordShape | null>
    saveCuratorState(record: CuratorStateRecordShape): Promise<void>
    transactCuratorState(task: (current: CuratorStateRecordShape | null) => CuratorStateRecordShape | null): Promise<void>
  } | undefined {
    const service = this.ctx.get('evolutionState') as {
      loadCuratorState(): Promise<CuratorStateRecordShape | null>
      saveCuratorState(record: CuratorStateRecordShape): Promise<void>
      transactCuratorState(task: (current: CuratorStateRecordShape | null) => CuratorStateRecordShape | null): Promise<void>
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
    // B-1/A2-3 (v18): the fourth control-plane mutator joins the SAME promise
    // chain as run()/restore()/consolidate() — a whole-tree rollback + full
    // curator-state write must never interleave with an in-flight run.
    const release = await this.acquireMutex()
    try {
      return await this.restoreSnapshotCore()
    } finally {
      release()
    }
  }

  private async restoreSnapshotCore(): Promise<SkillActionResult & { extras?: Array<{ name: string; content: string }> }> {
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
    // P1 (v16): run() joins the SAME control-plane mutex as restore/consolidate.
    // The skip decision is made on `mutexDepth` BEFORE enqueueing: a manual run
    // arriving behind a queued restore/in-flight run skips (E-7 semantics
    // preserved); a restore arriving behind a run queues (P2-5 semantics).
    // mutexDepth is incremented SYNCHRONOUSLY inside acquireMutex, so this
    // check is atomic with respect to every other entrant's request.
    if (this.mutexDepth > 0) {
      return {
        stale: [], archived: [], errors: [],
        report: this.skippedReport('already-running', new Date().toISOString()),
        skipped: 'already-running',
      }
    }
    const release = await this.acquireMutex()
    try {
      return await this.runCore(options)
    } finally {
      // P3 (v17): release FIRST — everything after it (retention, logging)
      // must not be able to hold the mutex hostage (a synchronous throw from
      // logger.warn would otherwise leave mutexDepth permanently elevated and
      // silently kill the whole control plane).
      release()
      // V4-22: recycle the report history on EVERY run end (success or failure).
      // Previously retention only ran on the successful report-write path, so a
      // host that kept throwing accumulated curator-error-*.json unbounded.
      try {
        await this.retainReports()
      } catch (error) {
        this.ctx.logger.warn(`evolution-curator: failed to retain reports: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /**
   * P1 (v16): the control-plane mutex — ONE promise chain serializing run(),
   * restore() and consolidate(). Replaces the v15 draft (`running` flag +
   * `runSettled` polling), which could (a) spin forever on an
   * already-resolved promise while a control-plane mutator held the flag
   * (micro-task starvation: the flag's reset lives behind IO the spun loop
   * never lets run) and (b) let two queued waiters wake into the same idle
   * window and mutate concurrently. Here the chain IS the mutex: an entrant
   * increments `mutexDepth` synchronously (so run()'s skip check sees queued
   * work), awaits the previous tail, and the returned release resolves the
   * tail for the next entrant. Double-release is a no-op.
   *
   * v20 (C-3) cross-layer note: this chain serializes CURATOR operations
   * only. The review subagent channel writes through its own SkillLibrary
   * and shares NO mutex with this service; the cross-layer exclusion is
   * skill-store's per-file write lock + the F-17 marker probe (a destructive
   * mover refuses a directory whose writer lock is alive), so a collision
   * degrades to a recorded failed op + snapshot rollback, never a torn
   * write. Automatic passes are kept out of the session-active window by the
   * min-idle gate — checked pre-run AND re-checked at the commit boundary
   * (v28 G4.2: a session activating mid-run no longer slips past it); a
   * manual run (`ignoreGates`) bypasses both checks and is
   * the one realistic interleave window — documented, accepted (plan v20
   * C-3①). The same statement lives on evolution-review's `reviewInFlight`.
   */
  private mutexDepth = 0
  private mutexTail: Promise<void> = Promise.resolve()

  private acquireMutex(): Promise<() => void> {
    this.mutexDepth += 1
    const prev = this.mutexTail
    let releaseMutex!: () => void
    this.mutexTail = new Promise<void>((resolve) => { releaseMutex = resolve })
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.mutexDepth -= 1
      releaseMutex()
    }
    return prev.then(() => release)
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
    // 0.3.18 (E-18): in a STATELESS composition (no state service) nothing was
    // persisted AND `this.lastRun` stayed stale, so every hourly tick re-entered
    // the defer — the automatic pass never ran (the docstring's in-memory clock
    // fallback was contradicted by the implementation). Advance the in-memory
    // baseline here so the NEXT tick compares against a fresh clock.
    if (!ignoreGates && persisted === null && (stateService !== undefined || !this.statelessFirstRunDeferred)) {
      if (stateService) {
        // v20 (C-4): best-effort like every other run-side persistence (see
        // the C1 discipline on the bookkeeping transact below) — a transient
        // state-storage failure must not turn the first-run DEFER into a
        // thrown run. Nothing advanced here, so the next tick simply re-enters
        // this branch and retries the seed.
        try {
          await stateService.saveCuratorState({
            schemaVersion: 1,
            lastRunAt: Date.now(),
            runCount: 0,
            lastSummary: 'first-run-deferred',
            paused: false,
          })
        } catch (error) {
          this.ctx.logger.warn(`evolution-curator: failed to persist the first-run baseline: ${error instanceof Error ? error.message : String(error)}`)
        }
      } else {
        this.lastRun = Date.now()
        this.statelessFirstRunDeferred = true
      }
      return {
        stale: [], archived: [], errors: [],
        report: this.skippedReport(runId, startedAt),
        skipped: stateService ? 'first-run-deferred' : 'first-run-deferred(stateless)',
      }
    }
    const root = this.skills.root
    const rawUsage: UsageMap = await loadUsage(root, this.io)
    // Dry-run computes on clones so the persisted lifecycle state is untouched.
    const usage: UsageMap = dryRun ? new Map([...rawUsage].map(([name, record]) => [name, { ...record }])) : rawUsage
    // A2-4 (v18): the lifecycle state each name had at RUN START — the
    // transitions engine below mutates `usage` in place, so this snapshot is
    // the only basis the fold can compare-and-set against.
    const runStartStates = new Map([...usage].map(([name, record]) => [name, record.state as string]))
    // v21 (L-4): B-8 mid-run gate. Dispose used to only clear the TIMER — an
    // in-flight pass kept mutating the tree (snapshot, archive, consolidate)
    // for minutes after unload, emitting through a dead fiber. Checked at the
    // mutation boundaries below; before THIS gate nothing has landed, so an
    // empty early return stays safe. The warn keeps the abort cause observable
    // (v23 BR-2: the report's `failed` filter cannot carry a free-form abort
    // message, so the log line is the only place the reason appears).
    if (this.isDisposed()) {
      this.ctx.logger.warn('evolution-curator: run aborted before the archive phase (plugin disposed mid-run)')
      return {
        stale: [], archived: [], errors: ['run aborted: evolution-curator was disposed mid-run'],
        report: this.skippedReport(runId, startedAt),
        skipped: 'disposed',
      }
    }
    // v29 CUR-05: the snapshot moved BELOW the min-idle re-check — it is the
    // rollback insurance for the mutation phase and a report field, nothing
    // between here and there needs it, and a session-blocked run no longer
    // mints an orphan `pre-curator-run` snapshot that churns the 5-slot
    // retention window.
    const suppressedNames = new Set(await loadSuppressedNames(root, this.io))
    // One GateSet instance per run (decision B) shared by the lifecycle
    // engine and the merge-nomination gate below.
    const gates = new EvolutionGateSet({
      exclude: this.excludeSkillNames,
      referenced: this.referencedSkillNames,
      suppressed: suppressedNames,
    })
    const { bundledNames, treeNames, resetToActive } = await this.seedBaseline(usage)
    // P2-5: near-duplicate groups join the recommendation candidate pool —
    // the deterministic scanner sees idle names, only the LLM sees overlap.
    const contents = new Map<string, string>()
    for (const name of treeNames) {
      const text = await this.skills.read(name)
      if (text) contents.set(name, text)
    }
    // F-331: the consolidation candidate pool must exclude marker-protected
    // skills (pinned/bundled/hub-installed). Nominating them into the LLM pool
    // is guaranteed to fail at the execution gate and only adds fixed report
    // noise — M-3 narrowed the PRUNING pool; this is the consolidation
    // counterpart.
    const protectedNames = await this.protectedNameMap()
    const dedupMembers = [...new Set(
      computeDedupGroups({ contents }).filter(group => group.length >= 2).flat(),
    )].filter(name => !protectedNames.has(name))
    // Score BEFORE the lifecycle transitions (rc.42 audit P1-2): the transition
    // engine reads `quality_warn` to apply the shorter quality-warn stale
    // window, so it must see THIS run's freshly computed scores — the old
    // order (transitions → scoring) applied last run's warn state and delayed
    // the quality-warn stale path by a full curator cycle.
    await this.scoreTree(usage, treeNames)
    // V9-02 (0.3.50): pass protectedNames into the transition engine — V8-14
    // wired the core signature and the scope view, but the PRODUCTION run
    // call stayed 4-argument, so marker-protected agent skills still entered
    // the archive candidates and produced the failed-step noise the 0.3.47
    // CHANGELOG declared gone.
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
    }, new Date(), gates, protectedNames)
    const recommendPool = [...new Set([...result.markStale, ...dedupMembers])]
    const nominations = this.llmReview
      ? await this.recommend(recommendPool, { dryRun })
      : { prunings: [], consolidations: [], warnings: [] as string[] }
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
    // v28 G4.2 (CUR-02): the min-idle gate was evaluated once, before a run
    // window that can span the LLM recommend() timeout (~120s). A session that
    // became active AFTER that check was invisible, so the automatic pass
    // could archive a skill the in-flight review was still writing against —
    // contradicting the cross-layer invariant both files document. Re-check at
    // the commit boundary; a hit skips the pass with the same structured shape
    // as the pre-run gate (one agents.list of cost, nothing applied).
    if (!ignoreGates && this.minIdleHours > 0 && this.recentSessionActive()) {
      // v29 CUR-04: persist the seeded usage baseline even though the pass is
      // skipped. `seedBaseline` stamped fresh `created_at` anchors for skills
      // absent from the sidecar; discarding them made a busy host (every tick
      // inside minIdleHours) re-seed a NEWER created_at on every attempt, so
      // those skills could never reach staleAfterDays. Set-if-absent only —
      // existing on-disk records are untouched. Best-effort: a persist failure
      // downgrades to a warn (the next run re-seeds identically).
      if (!dryRun) {
        try {
          await mutateUsage(root, this.io, (map) => {
            for (const [name, record] of usage) {
              if (!map.has(name)) map.set(name, { ...record })
            }
          })
        } catch (error) {
          this.ctx.logger.warn(`evolution-curator: failed to persist the seeded usage baseline on a session-blocked run (${error instanceof Error ? error.message : String(error)})`)
        }
      }
      // No `pre-curator-run` snapshot on the blocked path (v29 CUR-05): the
      // report simply carries none, matching the other pre-run gate skips.
      return {
        stale: [], archived: [], errors: [],
        report: this.skippedReport(runId, startedAt),
        skipped: 'active-session',
      }
    }
    const snapshotPath = dryRun ? undefined : await this.snapshotFull('pre-curator-run')
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
      // v31 SNAP-02: the seedBaseline archived→active resets are THIS run's
      // durable changes — folding them (CAS expected 'archived' == disk
      // 'archived') makes the stranding self-heal reach the sidecar instead
      // of dying with the run's memory.
      stateOwned: new Set([...result.transitions.map(t => t.name), ...archiveCandidates, ...resetToActive]),
      // A2-4 (v18): the CAS basis for the lifecycle fold (see runStartStates).
      runStartStates,
      failedFrom: new Map(result.transitions.filter(t => t.to === 'archived').map(t => [t.name, t.from as 'active' | 'stale'])),
    })
    // v28 G4.1 (CUR-01): a disposed mid-run must not anchor the durable
    // schedule as if the pass had completed — the aborted-run bookkeeping used
    // to push lastRunAt a full intervalHours (default 168h) into the future,
    // so the skipped work was never re-run. The rerun is idempotent (E-15);
    // an aborted pass leaves lastRun/lastRunAt/runCount untouched.
    const runAborted = errors.some(error => error.startsWith('run aborted'))
    if (!dryRun && !runAborted) this.lastRun = Date.now()
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
      // V27 CUR-2: the report used to keep only the skill-attributable failures,
      // so a run that was cut short wrote `failed: 0` and the digest read as a
      // clean run while `errors` (in memory) said otherwise. Run-level facts now
      // have their own fields: the abort reason and every error that names no
      // skill.
      ...(() => {
        const attributed = new Set([...archiveCandidates, ...gatedNominations.consolidations.map(item => item.from)])
        const loose = errors.filter(error => ![...attributed].some(name => error.startsWith(`${name}:`)))
        const abort = loose.find(error => error.startsWith('run aborted'))
        return {
          ...abort === undefined ? {} : { aborted: abort.slice('run aborted: '.length) },
          ...loose.length === 0 ? {} : { unattributed: loose },
        }
      })(),
      consolidated,
      ...snapshotPath === undefined ? {} : { snapshotPath },
      llmReviewEnabled: this.llmReview,
      // V6-35 (0.3.36): lenient-parse notes (mis-placed mode / section flip)
      // surface in the run report instead of a silent shape change.
      ...gatedNominations.warnings.length > 0 ? { nominationsWarnings: gatedNominations.warnings } : {},
    })
    const reportsRoot = join(evolutionHome(), 'reports')
    try {
      await this.io.writeText(join(reportsRoot, `curator-${runId}.json`), JSON.stringify(report, null, 2))
      // Human-readable digest alongside the JSON (G6); pruned with the same
      // retention pass below.
      await this.io.writeText(join(reportsRoot, `curator-${runId}.md`), renderCuratorReportMarkdown(report))
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
    // way the run's bookkeeping write must not clear the flag. E-16 (S5.5):
    // the whole read → transform → write now runs as ONE atomic
    // transactCuratorState, and `current` is the value at its queue slot, so a
    // concurrent setPaused's update is never overwritten by a stale snapshot.
    // C1 (v15): best-effort like every other run-side persistence (report/
    // suppressed/usage all catch) — a state-storage failure must not turn the
    // already-landed mutations into a thrown run; the cost is a missing
    // runCount tick and a repeat tick next hour (E-15 makes the rerun
    // idempotent), instead of an unhandled run failure.
    try {
      await stateService?.transactCuratorState((current) => {
        const pausedNow = current?.paused ?? false
        return {
          schemaVersion: 1,
          // E-51 (S5.6): a fresh-install manual run must anchor the interval
          // baseline at the run's OWN time, not the process-construction clock
          // (`this.lastRun`); take Date.now() at the save point. A dry-run is a
          // preview: it must not push the next scheduled pass out.
          // v28 G4.1 (CUR-01): an aborted run anchors at the PREVIOUS pass
          // (or construction time) and does not tick runCount — the skipped
          // work must be re-runnable at the next check, not a full interval later.
          lastRunAt: dryRun || runAborted ? (persisted?.lastRunAt ?? this.lastRun) : Date.now(),
          runCount: dryRun || runAborted ? (persisted?.runCount ?? 0) : (current?.runCount ?? 0) + 1,
          lastSummary: summary,
          paused: pausedNow,
        }
      })
    } catch (error) {
      this.ctx.logger.warn(`evolution-curator: failed to persist run bookkeeping: ${error instanceof Error ? error.message : String(error)}`)
    }
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
  private async seedBaseline(usage: UsageMap): Promise<{ bundledNames: Set<string>; treeNames: Set<string>; resetToActive: Set<string> }> {
    const bundledNames = new Set<string>()
    const treeNames = new Set<string>()
    // v31 SNAP-02: names whose record said `archived` while their directory is
    // LIVE in the tree — the reset must reach the sidecar (see the fold below)
    // or the stranding it heals persists forever.
    const resetToActive = new Set<string>()
    for (const summary of await this.skills.list()) {
      treeNames.add(summary.name)
      if (!usage.has(summary.name)) usage.set(summary.name, emptyRecord())
      if (await this.skills.isBundled(summary.name)) bundledNames.add(summary.name)
      // The marker is the factual source for pinning; mirror it BOTH ways onto
      // the usage record before the lifecycle gate reads it (a marker or a
      // stale mirrored `pinned: true` used to diverge from the gate).
      const record = usage.get(summary.name)
      // v30 SNAP-01: a record must never stay `archived` while its directory
      // is LIVE in the tree. That shape arises from the snapshot/mover races
      // (a mixed-generation rollback restores the tree while the sidecar
      // record reads archived) and from any missed archive-move; the lifecycle
      // engine excludes archived records from every candidate pool, so the
      // skill was stranded forever — never staled, scored, or nominated — and
      // E-15 heals only the inverse (record-active/dir-missing). Reset the
      // pair and let the lifecycle re-evaluate the skill normally.
      if (record?.state === 'archived') {
        record.state = 'active'
        record.archived_at = null
        resetToActive.add(summary.name)
      }
      if (record) record.pinned = await this.skills.isPinned(summary.name)
    }
    return { bundledNames, treeNames, resetToActive }
  }

  /**
   * F13 six-factor quality scoring, persisted onto the usage records.
   * P1-1 (v15): these are the CURATOR-owned fields (`quality_score`/
   * `quality_warn`) — this method must never touch the feedback-owned
   * `feedback_*` pair (the lifecycle engine reads the union of both warn
   * flags, so overwriting feedback here is what used to make negative
   * feedback decision-irrelevant; field ownership on `UsageRecord`).
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
    /** A2-4 (v18): run-start lifecycle state per name, the CAS basis for the fold. */
    runStartStates?: ReadonlyMap<string, string>
  }): Promise<{
    archivedSkills: CuratorArchivedSkill[]
    errors: string[]
    suppressedChanged: boolean
    consolidated: CuratorConsolidation[]
  }> {
    if (input.dryRun) return { archivedSkills: [], errors: [], suppressedChanged: false, consolidated: [] }
    const { archiveCandidates, nominations, treeNames, usage, bundledNames, suppressedNames, root, failedFrom } = input
    const runStartStates = input.runStartStates
    const errors: string[] = []
    // v28 G4.3 (CUR-03): the shared type keeps `path` optional — a
    // consolidation source has no trustworthy local path.
    const archivedSkills: CuratorArchivedSkill[] = []
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
    // v21 (L-4) / v22 (R-1): mid-run dispose gate — archive is the first
    // tree-mutating phase. NOTE: this method's declared return shape is
    // `{archivedSkills, errors, suppressedChanged, consolidated}` (runCore
    // destructures it), so the abort reports through `errors` — the earlier
    // attempt returned a runCore-shaped object with out-of-scope identifiers
    // and would have thrown ReferenceError when triggered. Nothing has landed
    // before this point, so the empty account is honest; the warn keeps the
    // cause observable (v23 BR-2).
    if (this.isDisposed()) {
      this.ctx.logger.warn('evolution-curator: run aborted at the archive gate (plugin disposed mid-run)')
      return { archivedSkills: [], errors: ['run aborted: evolution-curator was disposed mid-run'], suppressedChanged: false, consolidated: [] }
    }
    for (const name of archiveCandidates) {
      // E-15 (S5.4) two-phase self-heal: the archive rename (skills.archive
      // moves the directory into .archive) and the usage sidecar fold
      // (mutateUsage → foldCuratorFields) are TWO phases with no joint
      // commit — rename lands first, the fold lands second. A crash between
      // them leaves a usage record (state stale/active, archived_at null)
      // whose directory is gone. The next candidate pass must not re-attempt
      // the doomed rename and report a permanent failed entry: the rename
      // already committed, so fold the record to archived directly (state
      // migration only — no counter bump) and let the final mutateUsage
      // persist it. `treeNames` is the CURRENT tree (from skills.list()); a
      // candidate missing from it has no valid directory, so it is exactly
      // the crash-window shape. Fully-archived skills never reach this loop
      // (lifecycleCandidate excludes state='archived'), so a missing-dir
      // candidate always represents an unflushed earlier rename.
      if (!treeNames.has(name)) {
        const record = usage.get(name)
        if (record) {
          record.state = 'archived'
          record.archived_at = record.archived_at ?? new Date().toISOString()
          stateOwned.add(name)
          // v33 R2-2: OBSERVABILITY - this branch assumed the archive rename
          // had already landed (E-15's crash-window premise). Since REG-01 the
          // list() skips a dir-on-SKILL.md skill without the dir being gone,
          // so a hit here can also mean a STRANDED live directory that will
          // never re-enter the lifecycle. Say so instead of folding silently.
          this.ctx.logger.warn(`evolution-curator: skill "${name}" left the tree without an archive move - its usage record was folded to archived; if the directory is still on disk, repair or remove it manually (it will not re-enter the lifecycle while the record is archived)`)
        }
        // F-330 (0.3.26, v4 V4-02): the old guard checked `bundledNames.has(name)`,
        // but `bundledNames ⊆ treeNames` is a construction invariant (both are
        // filled from the same list()) — the branch was unreachable, so a
        // bundled skill whose crashed archive rename landed without the
        // suppression write stayed a ghost (dir alive + record archived). The
        // reliable bundled signal here is the ARCHIVE COPY's marker: the rename
        // moved the whole skill directory (markers included) into `.archive`,
        // so a `.bundled` marker there proves the crashed archive was a bundled
        // skill — mirror the success path's suppression write.
        // V5-20 (0.3.32): the archive destination is `<name>` and, when a
        // same-second archive already sits there, `<name>-<stamp>[-rand]`
        // (skill-store archive naming) — probe BOTH shapes; and a probe
        // failure is a warn, never a silent "not bundled" (which would skip
        // the suppression write).
        let wasBundled = false
        try {
          wasBundled = await this.io.exists(join(this.skills.root, '.archive', name, markerEntryName('bundled')))
          if (!wasBundled) {
            // V6-09 (0.3.36): a listing failure must NOT read as "not bundled"
            // (which would skip the suppression write) — let it throw into the
            // probe catch below and warn instead of the silent `catch (() => [])`.
            const archiveEntries = await this.io.list(join(this.skills.root, '.archive'))
            for (const entry of archiveEntries) {
              // V6-08 (0.3.36): match the PRECISE archive destination shape
              // `<name>-<stamp>` / `<name>-<stamp>-<rand>` (skill-store: stamp =
              // 14 chars from ISO, rand = 1-6 base36 chars) — never a bare
              // `<name>-` prefix, so a bundled SIBLING (e.g. `foo-bar`) cannot
              // make a crashed non-bundled `foo` a false positive (which would
              // suppress the lifecycle gate on the next rebuild of `foo`).
              // The name charset validates the anchor; no escaping needed.
              // P2-10 (v11): a hand-edited sidecar key must not reach RegExp
              // construction — unbalanced parens throw, a `|` changes the
              // match semantics and could eat a sibling's marker. Skip any
              // name outside the skill charset.
              if (!SKILL_NAME_RE.test(name)) continue
              if (!new RegExp(`^${name}-\\d{14}(-[0-9a-z]{1,6})?$`).test(entry)) continue
              wasBundled = await this.io.exists(join(this.skills.root, '.archive', entry, markerEntryName('bundled')))
              // E-3 precedent: confirm the archive is OURS by its frontmatter
              // name — a name-shaped directory from an unrelated skill must not
              // carry the bundled verdict for `name`. Only when the SKILL.md is
              // READABLE: a crashed archive without a body keeps the marker as
              // the signal (a missing body must not under-suppress).
              if (wasBundled) {
                const archivedBody = await this.io.readText(join(this.skills.root, '.archive', entry, 'SKILL.md')).catch(() => null)
                if (archivedBody !== null && parseFrontmatter(archivedBody)?.frontmatter.name !== name) wasBundled = false
              }
              if (wasBundled) break
            }
          }
        } catch (probeError) {
          this.ctx.logger.warn(`evolution-curator: bundled marker probe for "${name}" failed: ${probeError instanceof Error ? probeError.message : String(probeError)}`)
        }
        if (wasBundled) {
          suppressedNames.add(name)
          suppressedAdded.add(name)
          suppressedChanged = true
        }
        continue
      }
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
    // v21 (L-4) / v22 (R-1) / v23 (BR-1): mid-run dispose gate — consolidation
    // is the second tree-mutating phase. This gate must NOT early-return: the
    // archive loop above has already moved directories and collected real
    // accounts, so the suppression persist and usage fold below HAVE to run
    // for them (an empty return reported archived:0 while the tree was
    // mutated, and skipped both persistence phases). Skip only the loop.
    let consolidationDisposed = false
    if (this.isDisposed()) {
      consolidationDisposed = true
      errors.push('run aborted: evolution-curator was disposed mid-run — consolidation skipped; archives that landed above are still accounted')
      this.ctx.logger.warn('evolution-curator: consolidation phase skipped (plugin disposed mid-run); archive accounts above are preserved')
    }
    for (const nomination of consolidationDisposed ? [] : nominations.consolidations) {
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
      const consolidated = await this.skills.consolidate(nomination.into, [nomination.from], 'background_review', {
        ...nomination.mode === undefined ? {} : { mode: nomination.mode },
      })
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
      // v28 G4.3 (CUR-03): no fabricated path. The consolidation flow points
      // `path` at the TARGET; the source's real archive dir is chosen by
      // SkillLibrary.archive() with a stamp suffix on collision, so the
      // nominal `.archive/<name>` used to name a directory that may not
      // exist. Omit the field and point at the event that carries the truth.
      archivedSkills.push({ name: nomination.from, reason: `Consolidated into ${nomination.into} (exact archive path: the evolution/skill-mutated event, archivedPath)` })
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
      // A2-4 (v18): the lifecycle pair is compare-and-set against the run-start
      // state; names a concurrent process moved are reported and left alone.
      let skipped: string[] = []
      await mutateUsage(root, this.io, (disk) => {
        skipped = foldCuratorFields(disk, usage, stateOwned, runStartStates)
      }, {
        // P2-9 (v19): a quarantined sidecar keeps folding but must be visible.
        onQuarantine: (message) => { this.ctx.logger.warn(`evolution-curator: ${message}`) },
      })
      if (skipped.length > 0) {
        this.ctx.logger.warn(`evolution-curator: lifecycle fold skipped ${skipped.length} name(s) whose on-disk state moved during the run (a concurrent curator/tool won): ${skipped.join(', ')}`)
      }
    } catch {
      // Best-effort: curation decisions already landed; a failed usage flush
      // must not surface as a run error after the fact.
      this.ctx.logger.warn('evolution-curator: failed to persist usage sidecar')
    }
    // V24-14 (v24): the former `skillUsage.invalidate()` call here was
    // removed. It was the family's only production call into a test-support
    // API, and its justification — "the registry caches the sidecar in-process,
    // so its next telemetry flush would re-cover the curator's writes with a
    // stale cache" — describes a mechanism that no longer exists: since rc.50
    // (P2-2) every skill-usage mutate re-reads the sidecar fresh from disk
    // inside its own transact, so there is no stale cache to invalidate. The
    // `mutateUsage` fold above is authoritative the moment it commits.
    return { archivedSkills, errors, suppressedChanged, consolidated: executedConsolidations }
  }

  private recentSessionActive(): boolean {
    const agents = this.ctx.get('agents') as {
      list(): Array<{ session: { events: ReadonlyArray<{ time: number }> } }>
    } | undefined
    if (!agents) {
      // E-54: fail-open is the shipped default — an always-off `agents` service
      // (headless/scheduled composition) must not defer automatic curation
      // forever merely because activity cannot be measured. Set
      // minIdleFailOpen: false to fail closed (defer the run instead).
      return !this.minIdleFailOpen
    }
    let latest = 0
    for (const agent of agents.list()) {
      const events = agent.session.events
      const last = events.length === 0 ? 0 : events[events.length - 1]?.time ?? 0
      latest = Math.max(latest, last)
    }
    return latest > 0 && Date.now() - latest < this.minIdleHours * 3_600_000
  }

  /**
   * Keep only the newest N curator run reports plus at most `errorKeep` error
   * reports, ordered by the report's own `startedAt` (the runId is a UUID and
   * cannot order history). Best-effort like `retainSnapshots`: a failed removal
   * must not fail the run that just persisted its report. The paired `.md`
   * digest is pruned with its JSON.
   *
   * V4-22: real reports (`curator-*.json`) and error reports
   * (`curator-error-*.json`) are BUDGETED INDEPENDENTLY. Before this they shared
   * one keep-20 window, so after 25 consecutive failures the next successful
   * run's window held only a few real reports alongside the errors.
   */
  private async retainReports(keep = 20, errorKeep = 10): Promise<void> {
    const reportsRoot = join(evolutionHome(), 'reports')
    let entries: string[]
    try {
      entries = await this.io.list(reportsRoot)
    } catch {
      return
    }
    const real: Array<{ name: string; startedAt: number }> = []
    const errors: Array<{ name: string; startedAt: number }> = []
    for (const name of entries.filter(entry => entry.startsWith('curator-') && entry.endsWith('.json'))) {
      try {
        const raw = await this.io.readText(join(reportsRoot, name))
        if (raw === null) continue
        const parsed = JSON.parse(raw) as { startedAt?: string }
        let startedAt = typeof parsed.startedAt === 'string' ? Date.parse(parsed.startedAt) : Number.NaN
        // F-327: error reports (`curator-error-*.json`) carry no `startedAt`,
        // so the old code never ordered them and the sweep kept them forever.
        // Fall back to the file mtime (the write time) so they age into the
        // retention window too and no longer accumulate unbounded.
        if (!Number.isFinite(startedAt)) {
          const mtime = await this.io.mtime?.(join(reportsRoot, name)) ?? null
          if (mtime !== null) startedAt = mtime
        }
        if (Number.isFinite(startedAt)) (name.startsWith('curator-error-') ? errors : real).push({ name, startedAt })
      } catch {
        // Unclassifiable report: keep it — never delete what we cannot order.
      }
    }
    real.sort((a, b) => b.startedAt - a.startedAt)
    errors.sort((a, b) => b.startedAt - a.startedAt)
    await this.pruneReportList(reportsRoot, real, keep)
    await this.pruneReportList(reportsRoot, errors, errorKeep)
  }

  /** Remove the oldest reports beyond `keep` (each with its `.md` digest, best-effort). */
  private async pruneReportList(reportsRoot: string, dated: Array<{ name: string; startedAt: number }>, keep: number): Promise<void> {
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
    const names = (await this.io.list(reportsRoot)).filter(name => name.startsWith('curator-') && name.endsWith('.json') && !name.startsWith('curator-error-'))
    // E-54: filenames carry randomUUIDs — lexicographic order is NOT
    // chronological, and the old `.sort()` was a misleading no-op. Order by
    // each file's mtime (the report write time, from the optional mtime probe);
    // a report whose mtime is unavailable is never the latest (sorts last).
    let latest: { name: string; mtime: number } | null = null
    for (const name of names) {
      // mtime is an OPTIONAL probe (0.3.18, E-71): a backend without one
      // reports null via the adapter — such a report is never the latest.
      const mtime = await this.io.mtime?.(join(reportsRoot, name)) ?? null
      if (mtime === null) continue
      if (latest === null || mtime > latest.mtime) latest = { name, mtime }
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
    const thresholds: SkillHealthThresholds = {
      softBodyChars: this.healthSoftBodyChars,
      stampDensityPerKb: this.healthStampDensityPerKb,
      churnMinPatches: this.healthChurnMinPatches,
    }
    const usage = await loadUsage(this.skills.root, this.io)
    // C observation window: before ANY observed read exists in the library,
    // `view_count` zero is not evidence (reads were invisible pre-A2), so the
    // churn dimension is suppressed — no counts reach the assessment at all.
    const observed = usageObserved(usage)
    const rows: Array<{ name: string; verdict: SkillHealthVerdict; reasons: string[] }> = []
    for (const summary of await this.skills.list()) {
      const record = usage.get(summary.name)
      const assessment = await this.skills.assessHealth(summary.name, thresholds, observed && record ? {
        patchCount: record.patch_count,
        readCount: record.view_count,
      } : undefined)
      if (assessment && assessment.verdict !== 'healthy') rows.push({ name: summary.name, verdict: assessment.verdict, reasons: assessment.reasons })
    }
    return rows
  }

  /** Whether the library has ANY observed read evidence (C observation-window gate for churn signals). */
  async usageObserved(): Promise<boolean> {
    const usage = await loadUsage(this.skills.root, this.io)
    return usageObserved(usage)
  }

  /** marker info (pinned/bundled/hub-installed) per skill, from the library list. */
  private async protectedNameMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    for (const summary of await this.skills.list()) {
      // A1-17 (v18): a failed marker probe reads as protection-UNKNOWN and must
      // join the protected set — the alternative (treating it as unprotected)
      // would let the curator nominate a possibly pinned/bundled skill.
      if (summary.protectionUnknown) map.set(summary.name, 'unknown')
      else if (summary.protectedBy !== null) map.set(summary.name, summary.protectedBy)
    }
    return map
  }

  /**
   * Control-plane consolidation: merge source skill bodies into `target`,
   * archive the sources with an absorbed-into marker, and fold their usage
   * records into `archived` state. Snapshot-then-mutate, never a hard delete.
   */
  async consolidate(target: string, sources: string[]): Promise<SkillActionResult> {
    // P2-5 (v15)/v16: join the control-plane mutex — the mutation serializes
    // behind any in-flight run/restore/consolidate, and a run attempting to
    // start during the mutation gets the clean `already-running` skip.
    const release = await this.acquireMutex()
    try {
      return await this.consolidateMutate(target, sources)
    } finally {
      release()
    }
  }

  private async consolidateMutate(target: string, sources: string[]): Promise<SkillActionResult> {
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
    // B-7 (v18): the tree move already landed; a failed usage fold must not
    // turn a completed consolidate into a thrown control-plane error.
    try {
      await mutateUsage(this.skills.root, this.io, (disk) => {
        for (const source of sources) {
          const record = disk.get(source)
          if (record) {
            record.state = 'archived'
            record.archived_at = new Date().toISOString()
          }
        }
      }, { onQuarantine: (message) => { this.ctx.logger.warn(`evolution-curator: ${message}`) } })
    } catch (error) {
      this.ctx.logger.warn(`evolution-curator: failed to persist consolidate usage state: ${error instanceof Error ? error.message : String(error)}`)
    }
    return result
  }

  /**
   * Control-plane restore: bring one archived skill back to the active root
   * and reset its usage state, keeping the recoverable-archive invariant.
   */
  async restore(name: string): Promise<SkillActionResult> {
    // P2-5 (v15)/v16: join the control-plane mutex (same fold-ownership race
    // as consolidate).
    const release = await this.acquireMutex()
    try {
      return await this.restoreMutate(name)
    } finally {
      release()
    }
  }

  private async restoreMutate(name: string): Promise<SkillActionResult> {
    await this.snapshotFull('pre-restore')
    const result = await this.skills.restoreFromArchive(name)
    if (!result.ok) return result
    // rc.67 K-1: same transact-backed, malformed-safe fold as consolidate.
    // B-7 (v18): same best-effort posture as consolidate — the archive move
    // already landed.
    try {
      await mutateUsage(this.skills.root, this.io, (disk) => {
        const record = disk.get(name)
        if (record) {
          record.state = 'active'
          record.archived_at = null
        }
      }, { onQuarantine: (message) => { this.ctx.logger.warn(`evolution-curator: ${message}`) } })
    } catch (error) {
      this.ctx.logger.warn(`evolution-curator: failed to persist restore usage state: ${error instanceof Error ? error.message : String(error)}`)
    }
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
