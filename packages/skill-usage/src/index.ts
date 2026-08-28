/**
 * Skill usage telemetry service for the evolution family.
 * @module @deepseek-ai/dsh-skill-usage
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import { evolutionIoAdapter,  skillsRoot } from '@deepseek-ai/dsh-evolution-core'
import { bumpPatch, bumpUse, bumpView, getRecord, loadUsage, markAgentCreated, saveUsage, type UsageMap } from '@deepseek-ai/dsh-evolution-core'
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
    // `||` not `??`: schemastery's `default('')` yields '' which is NOT nullish,
    // so a config-driven '' must fall back to the real default path (P0-3).
    this.root = config.root || skillsRoot()
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

  /**
   * Ensure a usage record exists for `name` without bumping any counter
   * (rc.46 M3-3.3 companion): skill creation is authorship — the record must
   * exist from birth (created_at anchors now) but `patch_count` stays 0 so
   * mutation maturity is not inflated by mere creation.
   */
  async ensureRecord(name: string): Promise<void> {
    await this.mutate(async (map) => {
      getRecord(map, name)
      await this.flush()
    })
  }

  /**
   * Mark a skill's usage record as archived (delete / curator archive paths).
   * Unlike `record('patch')` this never bumps the patch counter — archiving is
   * a state transition, not a content mutation.
   */
  async markArchived(name: string, at = new Date()): Promise<void> {
    await this.mutate(async (map) => {
      const record = map.get(name)
      if (record) {
        record.state = 'archived'
        record.archived_at = at.toISOString()
      }
      await this.flush()
    })
  }

  /**
   * Drop the in-memory cache once queued work drains, so the next `map()` reads
   * the file again. The curator writes the sidecar directly; without this, the
   * next tool telemetry flush would re-cover its quality/state/pinned writes.
   */
  async invalidate(): Promise<void> {
    await this.chain
    this.usage = null
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
