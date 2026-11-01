import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SkillIndex, type SkillIndexQuery, type SkillIndexSource, type SkillIndexSourceSnapshot } from './skill-index.ts'
import { SkillSearchCache, type SkillSearchResponse } from './search.ts'
import { registerSkillSearchTool } from './tool.ts'

/** Search-only composition config. Domain/projection config is intentionally absent. */
export interface Config {
  /** Stable feature epoch used by later projection phases; required for config compatibility. */
  readonly featureEpoch: string
  /** Register the model-visible skill_search tool. Defaults to true. */
  readonly searchEnabled?: boolean | undefined
  /** Legacy discovery mode; search-only accepts only off and warns otherwise. */
  readonly mode?: 'off' | 'shadow' | 'on' | 'auto' | undefined
}

export const name = 'evolution-skill-discovery'
export const inject = ['skills', 'workingDirectory', 'tools']

interface WorkingDirectoryService {
  ensure(agent: Agent, signal?: AbortSignal | undefined): Promise<string>
}

class PlatformSearchIndexSource implements SkillIndexSource {
  private readonly ctx: Context
  constructor(ctx: Context) { this.ctx = ctx }

  async snapshot(query: SkillIndexQuery): Promise<SkillIndexSourceSnapshot> {
    const snapshot = await this.ctx.skills.snapshot({ cwd: query.cwd, ...query.scope === undefined ? {} : { scope: query.scope } })
    return { skills: snapshot.skills, complete: snapshot.complete }
  }

  async managedSkillKeys(): Promise<ReadonlySet<string>> { return new Set() }
  async protectedSkillKeys(): Promise<ReadonlySet<string>> { return new Set() }
  async pinnedSkillKeys(): Promise<ReadonlySet<string>> { return new Set() }
}

function unavailable(): SkillSearchResponse {
  return { results: [], truncated: false, degraded: true, hint: 'Skill search is unavailable without a session working directory.' }
}

/**
 * Compose the search-only discovery surface.
 * @param ctx - plugin context with skills, workingDirectory, and tools.
 * @param config - search-only configuration.
 */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.featureEpoch !== 'string' || config.featureEpoch.length === 0) throw new Error('evolution-skill-discovery: featureEpoch is required')
  if (config.mode !== undefined && config.mode !== 'off') {
    ctx.logger.warn('evolution-skill-discovery: mode=' + config.mode + ' is temporarily search-only; domain/projection is disabled until its producer is installed')
  }
  if (config.searchEnabled === false) return
  const source = new PlatformSearchIndexSource(ctx)
  const cache = new SkillSearchCache()
  const index = new SkillIndex(source)
  ctx.effect(() => registerSkillSearchTool(ctx, {
    async search(query, options, agent, signal) {
      if (agent === undefined) return unavailable()
      const workingDirectory = ctx.get('workingDirectory') as WorkingDirectoryService | undefined
      if (workingDirectory === undefined) return unavailable()
      const cwd = await workingDirectory.ensure(agent, signal)
      const view = await index.read({ cwd, scopeKey: String(agent.id), scope: agent, signal })
      const cached = await cache.get({ viewKey: view.viewKey, viewCatalogDigest: view.viewCatalogDigest, policyDigest: 'search-only', discoveryMode: 'off' }, view.rows)
      if (cached === undefined) return { results: [], truncated: false, degraded: true, hint: 'Skill search index is unavailable. Use the full catalog or skill(name).' }
      const result = await cached.index.search(query, options)
      return result.stale || cached.stale ? { ...result, stale: true } : result
    },
  }))
  ctx.on('evolution/skill-mutated', () => { cache.clear() })
}
