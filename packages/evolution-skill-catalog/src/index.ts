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
import type {} from '@deepseek-ai/dsh-evolution/src/events.ts'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution/src/skill-store.ts'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution/src/io.ts'
import { join } from 'node:path'

export const name = 'evolution-skill-catalog'
export const inject = ['skills', 'evolutionIo']

export interface Config {
  root?: string
  /** Whether catalog skills are advertised/loadable by the model. */
  modelInvocable?: boolean
  /** Whether catalog skills are advertised/loadable from user surfaces. */
  userInvocable?: boolean
}

export const Config: z<Config> = z.object({
  root: z.string().default(''),
  modelInvocable: z.boolean().default(true),
  userInvocable: z.boolean().default(true),
})

/** Below filesystem's user rank so the evolution-owned tree wins duplicates. */
export const EVOLUTION_SKILL_RANK = 390

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const invocation: SkillInvocationPolicy = {
    modelInvocable: rawConfig.modelInvocable ?? true,
    userInvocable: rawConfig.userInvocable ?? true,
  }
  const resolveIo = () => ctx.evolutionIo.provider()
  const io: EvolutionIoLike = {
    readText: path => resolveIo().readText(path),
    writeText: (path, content) => resolveIo().writeText(path, content),
    remove: path => resolveIo().remove(path),
    list: path => resolveIo().list(path),
    exists: path => resolveIo().exists(path),
    rename: (path, destination) => resolveIo().rename(path, destination),
    copy: (path, destination) => resolveIo().copy(path, destination),
  }
  const library = new SkillLibrary(rawConfig.root || undefined, io)
  let control: SkillProviderControl | undefined

  const provider: SkillProvider = {
    name: 'dsh-evolution',

    async list(_options: SkillLookupOptions) {
      const summaries = await library.list()
      return summaries.map(summary => ({
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
      const content = await library.read(name)
      if (content === null) return undefined
      const summary = (await library.list()).find(item => item.name === name)
      if (!summary) return undefined
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
