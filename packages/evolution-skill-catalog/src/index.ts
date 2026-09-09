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
import { evolutionIoAdapter, resolveSkillsRoot, SkillLibrary, type SkillSummary } from '@deepseek-ai/dsh-evolution-core'
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

/**
 * Below filesystem's user rank so the evolution-owned tree wins duplicates.
 *
 * P2-10 rank contract — this is a deliberate SHADOW of the upstream
 * `skill-filesystem` provider, not an arbitrary number:
 * - upstream `USER_DSH_RANK = 400` (skill-filesystem/src/index.ts) registers
 *   the SAME `user-dsh` source over the same `$DSH_HOME/skills` tree; the
 *   registry resolves duplicate names by "lower rank wins within a layer", so
 *   this provider must stay BELOW 400 to win.
 * - The shadow exists to remove the filesystem-watcher latency/window from the
 *   write → visible loop (this provider invalidates synchronously on
 *   `evolution/skill-mutated`).
 * - UPSTREAM UPGRADE CHECK: re-verify `USER_DSH_RANK` (and the duplicate-name
 *   comparison semantics) on every upstream bump — both constants are private
 *   to their packages, so a silent upstream change would flip the shadow
 *   without an error. The rank-contract test in tests/rank-contract.spec.ts
 *   pins the "lower rank wins" resolution on the registry side.
 */
const EVOLUTION_SKILL_RANK = 390

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const invocation: SkillInvocationPolicy = {
    modelInvocable: rawConfig.modelInvocable ?? true,
    userInvocable: rawConfig.userInvocable ?? true,
  }
  const io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
  const library = new SkillLibrary(resolveSkillsRoot(rawConfig), io)
  const included = new Set(rawConfig.includeSkillNames ?? [])
  const excluded = new Set(rawConfig.excludeSkillNames ?? [])
  const visible = (name: string) => (included.size === 0 || included.has(name)) && !excluded.has(name)
  let control: SkillProviderControl | undefined
  // 0.3.18 (S4.5, X-7): process-internal summaries cache — every `get()` used
  // to run a full tree scan (read + parse every SKILL.md). Dropped on
  // `evolution/skill-mutated` (in-band writes) and on `evolution/skills-refresh`.
  // P3 (v15, A1 correction; refined v16 after upstream re-read): the
  // root-mtime probe is a best-effort SECOND signal that only fires when this
  // provider is CONSULTED — it is not the reason an out-of-band write stays
  // invisible from `ctx.skills.list()`. E-71's pinned invisibility comes from
  // the UPSTREAM skill registry: `snapshot()`/`list()` resolve against the
  // collectCache and never call providers until a `control.invalidate()`
  // bumps the revision (the refresh event / `evolution/skill-mutated` do
  // that; a new root-level directory DOES touch the root's mtime, so the
  // probe itself would catch it — if it were ever asked). `ctx.skills.get()`
  // of an ALREADY-INDEXED name still calls `provider.get()` per invocation,
  // so an out-of-band CONTENT edit becomes visible there immediately (with a
  // stale description from the summaries cache); a NEW name stays invisible.
  // Out-of-band structural changes therefore require the explicit refresh
  // (decision C keeps no filesystem watcher); see README Known Limitations.
  let summariesCache: SkillSummary[] | null = null
  let summariesStamp: number | null = null
  async function summaries(): Promise<SkillSummary[]> {
    const stamp = await io.mtime?.(library.root) ?? null
    if (summariesCache !== null && (stamp === null || summariesStamp === stamp)) return summariesCache
    if (summariesCache !== null && stamp !== null) control?.invalidate()
    summariesCache = await library.list()
    summariesStamp = stamp
    return summariesCache
  }
  const dropSummariesCache = (): void => {
    summariesCache = null
    control?.invalidate()
  }

  const provider: SkillProvider = {
    name: 'dsh-evolution',

    async list(_options: SkillLookupOptions) {
      const all = await summaries()
      return all.filter(summary => visible(summary.name)).map(summary => ({
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
      const all = await summaries()
      const summary = all.find(item => item.name === name)
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
      dropSummariesCache()
    })
    const disposeRefresh = ctx.on('evolution/skills-refresh', () => {
      dropSummariesCache()
    })
    return () => {
      disposeRefresh()
      disposeEvent()
      unregister()
      control = undefined
    }
  }, 'evolution-skill-catalog.provider')
}
