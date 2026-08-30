/**
 * Native `ctx.skills` provider for the evolution-managed skill tree.
 *
 * `tool-skill-manage` writes skills through `ctx.evolutionIo`; this provider
 * publishes the same tree into DSH's skill registry and invalidates its
 * catalog synchronously on `evolution/skill-mutated`, removing the
 * filesystem-watcher latency/window from the write → visible loop.
 * @module @deepseek-ai/dsh-evolution-skill-catalog
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-evolution-io'
import type {} from '@deepseek-ai/dsh-evolution-core'
import { evolutionIoAdapter,  SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { join } from 'node:path'

export const name = 'evolution-skill-catalog'
export const inject = ['skills', 'evolutionIo']

export interface Config {
  root?: string
  /** Whether catalog skills are advertised/loadable by the model. */
  modelInvocable?: boolean
  /** Whether catalog skills are advertised/loadable from user surfaces. */
  userInvocable?: boolean
  /** Restrict the published catalog to these skill names (empty = all). */
  includeSkillNames?: string[]
  /** Hide these skill names from the published catalog. */
  excludeSkillNames?: string[]
}

export const Config: z<Config> = z.object({
  root: z.string().default(''),
  modelInvocable: z.boolean().default(true),
  userInvocable: z.boolean().default(true),
  includeSkillNames: z.array(z.string()).default([]),
  excludeSkillNames: z.array(z.string()).default([]),
})

/** Below filesystem's user rank so the evolution-owned tree wins duplicates. */
const EVOLUTION_SKILL_RANK = 390

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const invocation: SkillInvocationPolicy = {
    modelInvocable: rawConfig.modelInvocable ?? true,
    userInvocable: rawConfig.userInvocable ?? true,
  }
  const io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
  const library = new SkillLibrary(rawConfig.root || undefined, io)
  const included = new Set(rawConfig.includeSkillNames ?? [])
  const excluded = new Set(rawConfig.excludeSkillNames ?? [])
  const visible = (name: string) => (included.size === 0 || included.has(name)) && !excluded.has(name)
  let control: SkillProviderControl | undefined

  const provider: SkillProvider = {
    name: 'dsh-evolution',

    async list(_options: SkillLookupOptions) {
      const summaries = await library.list()
      return summaries.filter(summary => visible(summary.name)).map(summary => ({
        name: summary.name,
        description: summary.description,
        invocation,
        source: 'user-dsh' as const,
        provider: 'dsh-evolution',
        rank: EVOLUTION_SKILL_RANK,
        locator: { name: summary.name },
        path: join(summary.path, 'SKILL.md'),
        resourceBase: { kind: 'directory' as const, path: summary.path },
      }))
    },

    async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
      const name = candidate.name
      if (!visible(name)) return undefined
      // One list per call, shared by lookup and metadata (P2-6): the summary
      // set is fetched once and re-used instead of a second full scan.
      const summaries = await library.list()
      const summary = summaries.find(item => item.name === name)
      if (!summary) return undefined
      const content = await library.read(name)
      if (content === null) return undefined
      return {
        name,
        description: summary.description,
        invocation,
        source: 'user-dsh',
        provider: 'dsh-evolution',
        resourceBase: { kind: 'directory', path: summary.path },
        content,
        path: join(summary.path, 'SKILL.md'),
      }
    },
  }

  ctx.effect(() => {
    const unregister = ctx.skills.registerProvider((providerControl) => {
      control = providerControl
      return provider
    })
    const disposeEvent = ctx.on('evolution/skill-mutated', () => {
      control?.invalidate()
    })
    return () => {
      disposeEvent()
      unregister()
      control = undefined
    }
  }, 'evolution-skill-catalog.provider')
}
