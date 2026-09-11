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
import { evolutionIoAdapter, resolveSkillsRoot, SkillLibrary, SKILL_NAME_RE, type SkillSummary } from '@deepseek-ai/dsh-evolution-core'
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

/**
 * The mirror's `SKILL_NAME_RE` now carries the same shape (计划 B-4, v18), but
 * this provider still filters: an EXISTING tree entry created before the
 * tightening (trailing/consecutive hyphen) must not be forwarded, because
 * upstream `validateCandidate` throws on it and that throw aborts the WHOLE
 * `ctx.skills` collection (the caller is outside the provider try/catch),
 * taking down `agent/pre-step` and the `skill` tool for the session.
 */
const UPSTREAM_SKILL_NAME_RE = SKILL_NAME_RE

/** Upstream `validateCandidate` also refuses an empty description; the
 * mirror's `SkillLibrary.list()` legitimately reports `''` for a 0-byte or
 * malformed SKILL.md (C-14 keeps it visible to the curator). Such an entry
 * must not reach the platform registry. */
function publishableSkill(name: string, description: string): boolean {
  return UPSTREAM_SKILL_NAME_RE.test(name) && description.trim().length > 0
}

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
  // P1-1 (v18): one warn per unpublishable name — a malformed entry is an
  // operator-visible data problem, but a per-call warn would flood the log
  // once per snapshot/list/get.
  const warnedUnpublishable = new Set<string>()
  const warnUnpublishable = (name: string, description: string): void => {
    if (warnedUnpublishable.has(name)) return
    warnedUnpublishable.add(name)
    ctx.logger.warn(`evolution-skill-catalog: not publishing "${name}" — ${description.trim().length === 0 ? 'empty description' : 'name is not accepted by the upstream skill registry'} (fix the SKILL.md frontmatter; the curator still sees the entry)`)
  }
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
  // V24-02 (v24): generation counter — `dropSummariesCache` bumps it, and a
  // scan that started BEFORE a drop discards its result instead of caching
  // it. Without this, an in-flight `library.list()` (a full tree scan that
  // can interleave a concurrent skill_manage/curator write in multi-session
  // hosts) repopulated the cache with the PRE-mutation list after the drop,
  // and — because a content-only edit does not change the root's mtime —
  // every later consult then hit `summariesStamp === stamp` and served the
  // stale descriptions until the next structural change.
  let summariesEpoch = 0
  async function summaries(): Promise<SkillSummary[]> {
    const stamp = await io.mtime?.(library.root) ?? null
    if (summariesCache !== null && (stamp === null || summariesStamp === stamp)) return summariesCache
    if (summariesCache !== null && stamp !== null) control?.invalidate()
    const epochAtScanStart = summariesEpoch
    const scanned = await library.list()
    if (epochAtScanStart === summariesEpoch) {
      summariesCache = scanned
      summariesStamp = stamp
    }
    // A drop during the scan returns the scanned list to THIS caller (it is
    // a coherent snapshot) but leaves the cache empty — the next consult
    // rescans and observes the mutation.
    return scanned
  }
  const dropSummariesCache = (): void => {
    summariesEpoch += 1
    summariesCache = null
    control?.invalidate()
  }

  const provider: SkillProvider = {
    name: 'dsh-evolution',

    async list(options: SkillLookupOptions) {
      // E-10 (v18): the upstream registry aborts discovery; honor the signal
      // before and after the tree scan so a cancelled call settles promptly.
      options.signal?.throwIfAborted()
      const all = await summaries()
      options.signal?.throwIfAborted()
      return all.filter((summary) => {
        if (!visible(summary.name)) return false
        if (!publishableSkill(summary.name, summary.description)) {
          warnUnpublishable(summary.name, summary.description)
          return false
        }
        return true
      }).map(summary => ({
        name: summary.name,
        description: summary.description,
        // E-11 (v18): the upstream provider publishes `whenToUse` from the
        // frontmatter; this shadowing provider must too, or the host/UI routing
        // hint disappears while it shadows `skill-filesystem`.
        ...summary.whenToUse !== undefined ? { whenToUse: summary.whenToUse } : {},
        invocation,
        source: 'user-dsh' as const,
        provider: 'dsh-evolution',
        rank: EVOLUTION_SKILL_RANK,
        locator: { name: summary.name },
        path: join(summary.path, 'SKILL.md'),
        resourceBase: { kind: 'directory' as const, path: summary.path },
      }))
    },

    async get(candidate: SkillCandidate, options?: SkillLookupOptions): Promise<SkillDefinition | undefined> {
      options?.signal?.throwIfAborted()
      const name = candidate.name
      if (!visible(name)) return undefined
      const all = await summaries()
      const summary = all.find(item => item.name === name)
      if (!summary) return undefined
      // P1-1 (v18): get() is the second publish path — an invalid candidate
      // must not reach the upstream registry here either.
      if (!publishableSkill(summary.name, summary.description)) {
        warnUnpublishable(summary.name, summary.description)
        return undefined
      }
      const content = await library.read(name)
      if (content === null) return undefined
      return {
        name,
        description: summary.description,
        ...summary.whenToUse !== undefined ? { whenToUse: summary.whenToUse } : {},
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
