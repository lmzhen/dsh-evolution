/**
 * Deterministic skill lifecycle curator with interval gate and archive.
 * @module @deepseek-ai/dsh-evolution-curator
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution/src/skill-store.ts'
import { loadUsage, saveUsage, type UsageMap } from '@deepseek-ai/dsh-evolution/src/usage.ts'
import { computeLifecycleTransitions } from '@deepseek-ai/dsh-evolution/src/curator.ts'
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
}

export class EvolutionCurator extends Service {
  static Config: Schema<Config> = z.object({
    enabled: z.boolean().default(true),
    intervalHours: z.number().default(168),
    staleAfterDays: z.number().default(30),
    archiveAfterDays: z.number().default(90),
  })

  readonly skills = new SkillLibrary()
  private readonly enabled: boolean
  private readonly intervalHours: number
  private readonly staleAfterDays: number
  private readonly archiveAfterDays: number
  private lastRun = 0
  private timer: NodeJS.Timeout | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionCurator')
    this.enabled = config.enabled ?? true
    this.intervalHours = config.intervalHours ?? 168
    this.staleAfterDays = config.staleAfterDays ?? 30
    this.archiveAfterDays = config.archiveAfterDays ?? 90
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
    const usage: UsageMap = await loadUsage(root)
    const result = computeLifecycleTransitions(usage, {
      staleAfterDays: this.staleAfterDays,
      archiveAfterDays: this.archiveAfterDays,
      pruneBuiltins: true,
    })
    const errors: string[] = []
    for (const name of result.archive) {
      const archived = await this.skills.archive(name, 'Lifecycle: reached archive threshold')
      if (!archived.ok) {
        const record = usage.get(name)
        if (record) record.state = 'active'
        errors.push(`${name}: ${archived.message}`)
      }
    }
    await saveUsage(root, usage)
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
