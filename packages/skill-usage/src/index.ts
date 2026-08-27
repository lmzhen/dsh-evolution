/**
 * Skill usage telemetry service for the evolution family.
 * @module @deepseek-ai/dsh-skill-usage
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import { evolutionIoAdapter,  skillsRoot } from '@deepseek-ai/dsh-evolution-core'
import { bumpPatch, bumpUse, bumpView, loadUsage, markAgentCreated, saveUsage, type UsageMap } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillUsage: SkillUsageRegistry
  }
}

export interface Config {
  root?: string
}

export class SkillUsageRegistry extends Service {
  static inject = ['evolutionIo']
  static Config: Schema<Config> = z.object({
    root: z.string().default(''),
  })

  readonly root: string
  private readonly io: EvolutionIoLike
  private usage: UsageMap | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillUsage')
    this.root = config.root ?? skillsRoot()
    this.io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
  }

  private async map(): Promise<UsageMap> {
    if (!this.usage) this.usage = await loadUsage(this.root, this.io)
    return this.usage
  }

  async flush(): Promise<void> {
    if (this.usage) await saveUsage(this.root, this.usage, this.io)
  }

  /** Serialize read-modify-write cycles so concurrent record calls never lose updates. */
  private mutate<T>(task: (map: UsageMap) => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => task(await this.map()))
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  async record(name: string, kind: 'use' | 'view' | 'patch', at = new Date()): Promise<void> {
    await this.mutate(async (map) => {
      if (kind === 'use') bumpUse(map, name, at)
      else if (kind === 'view') bumpView(map, name, at)
      else bumpPatch(map, name, at)
      await this.flush()
    })
  }

  report(): Promise<UsageMap> {
    return this.mutate(map => Promise.resolve(new Map(map)))
  }

  async markAgentCreated(name: string): Promise<void> {
    await this.mutate(async (map) => {
      markAgentCreated(map, name)
      await this.flush()
    })
  }

  /** Write feedback-derived quality onto the usage sidecar; curator reads it. */
  async setQuality(name: string, score: number, warn: boolean): Promise<void> {
    await this.mutate(async (map) => {
      const record = map.get(name)
      if (!record) return
      record.quality_score = score
      record.quality_warn = warn
      await this.flush()
    })
  }
}

export default SkillUsageRegistry
