/**
 * Skill usage telemetry service for the evolution family.
 * @module @deepseek-ai/dsh-skill-usage
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import { skillsRoot } from '@deepseek-ai/dsh-evolution/src/skill-store.ts'
import { bumpPatch, bumpUse, bumpView, loadUsage, saveUsage, type UsageMap } from '@deepseek-ai/dsh-evolution/src/usage.ts'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution/src/io.ts'

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
    this.io = {
      readText: path => ctx.evolutionIo.provider().readText(path),
      writeText: (path, content) => ctx.evolutionIo.provider().writeText(path, content),
      remove: path => ctx.evolutionIo.provider().remove(path),
      list: path => ctx.evolutionIo.provider().list(path),
      exists: path => ctx.evolutionIo.provider().exists(path),
      rename: (path, destination) => ctx.evolutionIo.provider().rename(path, destination),
      copy: (path, destination) => ctx.evolutionIo.provider().copy(path, destination),
    }
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
    await this.mutate(async map => {
      if (kind === 'use') bumpUse(map, name, at)
      else if (kind === 'view') bumpView(map, name, at)
      else bumpPatch(map, name, at)
      await this.flush()
    })
  }

  async report(): Promise<UsageMap> {
    return await this.mutate(async map => new Map(map))
  }

  async markAgentCreated(name: string): Promise<void> {
    await this.mutate(async map => {
      const { markAgentCreated } = await import('@deepseek-ai/dsh-evolution/src/usage.ts')
      markAgentCreated(map, name)
      await this.flush()
    })
  }

  /** Write feedback-derived quality onto the usage sidecar; curator reads it. */
  async setQuality(name: string, score: number, warn: boolean): Promise<void> {
    await this.mutate(async map => {
      const record = map.get(name)
      if (!record) return
      record.quality_score = score
      record.quality_warn = warn
      await this.flush()
    })
  }
}

export default SkillUsageRegistry
