/**
 * Skill usage telemetry service for the evolution family.
 * @module @deepseek-ai/dsh-skill-usage
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { skillsRoot } from '@deepseek-ai/dsh-evolution/src/skill-store.ts'
import { bumpPatch, bumpUse, bumpView, loadUsage, saveUsage, type UsageMap } from '@deepseek-ai/dsh-evolution/src/usage.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillUsage: SkillUsageRegistry
  }
}

export interface Config {
  root?: string
}

export class SkillUsageRegistry extends Service {
  static Config: Schema<Config> = z.object({
    root: z.string().default(''),
  })

  readonly root: string
  private usage: UsageMap | null = null

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillUsage')
    this.root = config.root ?? skillsRoot()
  }

  private async map(): Promise<UsageMap> {
    if (!this.usage) this.usage = await loadUsage(this.root)
    return this.usage
  }

  async flush(): Promise<void> {
    if (this.usage) await saveUsage(this.root, this.usage)
  }

  async record(name: string, kind: 'use' | 'view' | 'patch', at = new Date()): Promise<void> {
    const map = await this.map()
    if (kind === 'use') bumpUse(map, name, at)
    else if (kind === 'view') bumpView(map, name, at)
    else bumpPatch(map, name, at)
    await this.flush()
  }

  async report(): Promise<UsageMap> {
    return new Map(await this.map())
  }

  async markAgentCreated(name: string): Promise<void> {
    const { markAgentCreated } = await import('@deepseek-ai/dsh-evolution/src/usage.ts')
    markAgentCreated(await this.map(), name)
    await this.flush()
  }
}

export default SkillUsageRegistry
