/**
 * Deterministic skill lifecycle curator with interval gate and archive.
 * @module @deepseek-ai/dsh-evolution-curator
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution/src/skill-store.ts'
import { loadUsage, saveUsage, type UsageMap } from '@deepseek-ai/dsh-evolution/src/usage.ts'
import { computeLifecycleTransitions } from '@deepseek-ai/dsh-evolution/src/curator.ts'
import { CURATOR_PROMPT } from '@deepseek-ai/dsh-evolution/src/prompts.ts'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution/src/io.ts'
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
  })

  readonly skills: SkillLibrary
  private readonly io: EvolutionIoLike
  private readonly enabled: boolean
  private readonly intervalHours: number
  private readonly staleAfterDays: number
  private readonly archiveAfterDays: number
  private readonly llmReview: boolean
  private readonly curatorProvider: string
  private lastRun = 0
  private timer: NodeJS.Timeout | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionCurator')
    this.io = {
      readText: path => ctx.evolutionIo.provider().readText(path),
      writeText: (path, content) => ctx.evolutionIo.provider().writeText(path, content),
      remove: path => ctx.evolutionIo.provider().remove(path),
      list: path => ctx.evolutionIo.provider().list(path),
      exists: path => ctx.evolutionIo.provider().exists(path),
      rename: (path, destination) => ctx.evolutionIo.provider().rename(path, destination),
      copy: (path, destination) => ctx.evolutionIo.provider().copy(path, destination),
    }
    this.skills = new SkillLibrary(undefined, this.io)
    this.enabled = config.enabled ?? true
    this.intervalHours = config.intervalHours ?? 168
    this.staleAfterDays = config.staleAfterDays ?? 30
    this.archiveAfterDays = config.archiveAfterDays ?? 90
    this.llmReview = config.llmReview ?? false
    this.curatorProvider = config.curatorProvider ?? 'deepseek-official'
    this.lastRun = Date.now()
    this.ctx.effect(() => () => this.stop(), 'evolution-curator.stop')
  }

  start(): void {
    if (!this.enabled || this.timer) return
    this.timer = setInterval(() => {
      if (Date.now() - this.lastRun >= this.intervalHours * 3_600_000) void this.run()
    }, 60 * 60 * 1000)
    if (this.timer.unref) this.timer.unref()
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
      stream(options: { provider: string; model: string; messages: unknown[]; maxTokens: number; purpose?: string }): AsyncIterable<StreamChunk>
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
        maxTokens: 2048,
        purpose: 'evolution-curator',
      })) assembler.push(chunk)
      const text = assembler.blocks().filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text').map(block => block.text).join('\n')
      const names = new Set<string>()
      const section = text.slice(text.indexOf('prunings:'))
      for (const match of section.matchAll(/^\s*-\s*name:\s*([a-z0-9][a-z0-9-]*)\s*$/gm)) names.add(match[1]!)
      return [...names].filter(name => candidates.includes(name))
    } catch {
      // LLM curation is advisory. The deterministic scanner still owns the decision.
      return []
    }
  }

  async run(): Promise<{ stale: string[]; archived: string[]; errors: string[] }> {
    const stateService = this.ctx.get('evolutionState') as {
      loadCuratorState(): Promise<{ lastRunAt: number; runCount: number; lastSummary: string; paused: boolean } | null>
      saveCuratorState(record: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean }): Promise<void>
    } | undefined
    const persisted = await stateService?.loadCuratorState()
    if (persisted && Date.now() - persisted.lastRunAt < this.intervalHours * 3_600_000) {
      return { stale: [], archived: [], errors: [] }
    }
    const root = this.skills.root
    await this.skills.snapshotAll('pre-curator-run')
    const usage: UsageMap = await loadUsage(root, this.io)
    const result = computeLifecycleTransitions(usage, {
      staleAfterDays: this.staleAfterDays,
      archiveAfterDays: this.archiveAfterDays,
      pruneBuiltins: true,
    })
    const errors: string[] = []
    const llmNominations = this.llmReview ? await this.recommend(result.markStale) : []
    const archiveCandidates = [...new Set([...result.archive, ...llmNominations])]
    for (const name of archiveCandidates) {
      const archived = await this.skills.archive(name, 'Lifecycle: reached archive threshold')
      if (!archived.ok) {
        const record = usage.get(name)
        if (record) record.state = 'active'
        errors.push(`${name}: ${archived.message}`)
      }
    }
    await saveUsage(root, usage, this.io)
    this.lastRun = Date.now()
    await stateService?.saveCuratorState({
      lastRunAt: this.lastRun,
      runCount: (persisted?.runCount ?? 0) + 1,
      lastSummary: `stale:${result.markStale.length} archived:${result.archive.length}`,
      paused: false,
    })
    return { stale: result.markStale, archived: result.archive, errors }
  }
}

export default EvolutionCurator
