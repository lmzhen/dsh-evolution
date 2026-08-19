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
import { buildCuratorRunReport, computeLifecycleTransitions, type CuratorRunReport, type SkillActionResult } from '@deepseek-ai/dsh-evolution-core'
import { evolutionHome } from '@deepseek-ai/dsh-evolution-core'
import { CURATOR_PROMPT } from '@deepseek-ai/dsh-evolution-core'
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
  /** Max tokens for the optional LLM nomination pass. */
  curatorReviewMaxTokens?: number
}

export class EvolutionCurator extends Service {
  static inject = ['evolutionIo']
  static Config: Schema<Config> = z.object({
    enabled: z.boolean().default(true),
    intervalHours: z.number().default(168),
    staleAfterDays: z.number().default(30),
    archiveAfterDays: z.number().default(90),
    llmReview: z.boolean().default(false),
    curatorProvider: z.string().default('deepseek-official'),
    qualityWarnStaleAfterDays: z.number().default(7),
    minIdleHours: z.number().default(0),
    excludeSkillNames: z.array(z.string()).default([]),
    manageUnmanaged: z.boolean().default(false),
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
    this.minIdleHours = config.minIdleHours ?? 0
    this.excludeSkillNames = new Set(config.excludeSkillNames ?? [])
    this.manageUnmanaged = config.manageUnmanaged ?? false
    this.curatorReviewMaxTokens = config.curatorReviewMaxTokens ?? 2048
    this.lastRun = Date.now()
    this.ctx.effect(() => {
      return () => {
        this.stop()
      }
    }, 'evolution-curator.stop')
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
   * Optional Hermes-curator LLM pass. The model may only NOMINATE pruning
   * candidates; archive/restore remains a control-plane operation and every
   * nominated name is still checked against lifecycle thresholds and
   * protected markers before any file move.
   */
  async recommend(candidates: string[]): Promise<string[]> {
    if (candidates.length === 0) return []
    const llm = this.ctx.get('llm') as {
      stream(options: {
        provider: string
        model: string
        messages: unknown[]
        maxTokens: number
        purpose?: string
      }): AsyncIterable<StreamChunk>
    } | undefined
    if (!llm) return []
    const policy = this.ctx.get('evolutionPolicy') as { get(): { curatorModel: string } } | undefined
    const model = policy?.get().curatorModel ?? 'deepseek-v4-pro'
    const prompt = [
      CURATOR_PROMPT,
      '',
      'Stale candidates observed by the deterministic lifecycle scanner:',
      ...candidates.map(name => `- ${name}`),
      '',
      'Return a YAML summary with a prunings list. Nominate only candidates whose archival is clearly safe.',
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
      const names = new Set<string>()
      const section = text.slice(text.indexOf('prunings:'))
      for (const [, name] of section.matchAll(/^\s*-\s*name:\s*([a-z0-9][a-z0-9-]*)\s*$/gm)) if (name) names.add(name)
      return [...names].filter(name => candidates.includes(name))
    } catch {
      // LLM curation is advisory. The deterministic scanner still owns the decision.
      return []
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
    })
  }

  async run(): Promise<{ stale: string[]; archived: string[]; errors: string[]; report: CuratorRunReport; skipped?: string }> {
    const startedAt = new Date().toISOString()
    const runId = randomUUID()
    const stateService = this.ctx.get('evolutionState') as {
      loadCuratorState(): Promise<{ lastRunAt: number; runCount: number; lastSummary: string; paused: boolean } | null>
      saveCuratorState(record: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean }): Promise<void>
    } | undefined
    const lifecycle = this.lifecycle()
    const persisted = await stateService?.loadCuratorState()
    if (persisted && Date.now() - persisted.lastRunAt < lifecycle.intervalHours * 3_600_000) {
      return {
        stale: [], archived: [], errors: [],
        report: this.skippedReport(runId, startedAt),
        skipped: 'interval',
      }
    }
    if (this.minIdleHours > 0 && this.recentSessionActive()) {
      return {
        stale: [], archived: [], errors: [],
        report: this.skippedReport(runId, startedAt),
        skipped: 'active-session',
      }
    }
    const root = this.skills.root
    const snapshotPath = await this.skills.snapshotAll('pre-curator-run')
    const usage: UsageMap = await loadUsage(root, this.io)
    const result = computeLifecycleTransitions(usage, {
      staleAfterDays: lifecycle.staleAfterDays,
      archiveAfterDays: lifecycle.archiveAfterDays,
      qualityWarnStaleAfterDays: this.qualityWarnStaleAfterDays,
      excludeSkillNames: this.excludeSkillNames,
      manageUnmanaged: this.manageUnmanaged,
    })
    const errors: string[] = []
    const archivedSkills: Array<{ name: string; path: string; reason: string }> = []
    const llmNominations = this.llmReview ? await this.recommend(result.markStale) : []
    const archiveCandidates = [...new Set([...result.archive, ...llmNominations])]
    for (const name of archiveCandidates) {
      const archived = await this.skills.archive(name, 'Lifecycle: reached archive threshold')
      if (!archived.ok) {
        const record = usage.get(name)
        if (record) record.state = 'active'
        errors.push(`${name}: ${archived.message}`)
      } else {
        archivedSkills.push({ name, path: archived.path ?? '', reason: 'Lifecycle: reached archive threshold' })
      }
    }
    await saveUsage(root, usage, this.io)
    this.lastRun = Date.now()
    const finishedAt = new Date().toISOString()
    const report = buildCuratorRunReport({
      runId,
      startedAt,
      finishedAt,
      staleCandidates: result.markStale,
      llmNominations,
      archiveCandidates,
      archived: archivedSkills,
      failed: archiveCandidates.filter(name => errors.some(error => error.startsWith(`${name}:`))).map((name) => {
        const error = errors.find(item => item.startsWith(`${name}:`))
        return { name, reason: error?.slice(name.length + 2) ?? 'unknown' }
      }),
      snapshotPath,
    })
    const reportsRoot = join(evolutionHome(), 'reports')
    try {
      await this.io.writeText(join(reportsRoot, `curator-${runId}.json`), JSON.stringify(report, null, 2))
    } catch (error) {
      // Report persistence is best-effort; curation decisions already landed.
      this.ctx.logger.warn(`evolution-curator: failed to persist report ${runId}`)
      this.ctx.logger.warn(error)
    }
    await stateService?.saveCuratorState({
      lastRunAt: this.lastRun,
      runCount: (persisted?.runCount ?? 0) + 1,
      lastSummary: `stale:${result.markStale.length} archived:${archivedSkills.length}`,
      paused: false,
    })
    return { stale: result.markStale, archived: archivedSkills.map(item => item.name), errors, report }
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
    await saveUsage(this.skills.root, usage, this.io)
    return result
  }
}

export default EvolutionCurator
