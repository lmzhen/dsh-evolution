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
import { evolutionIoAdapter, parseFrontmatter, resolveSkillsRoot, SkillLibrary, SKILL_NAME_RE, type SkillSummary } from '@deepseek-ai/dsh-evolution-core'
import { join } from 'node:path'

export const name = 'evolution-skill-catalog'
export const inject = ['skills', 'evolutionIo']

export interface Config {
  root?: string
  /** Row-level DEFAULT invocation policy. OPT-10 (2026-09): a skill's own
   * SKILL.md frontmatter (`disable-model-invocation` / `user-invocable`) now
   * overrides this per skill — before, the row default was stamped onto every
   * candidate and a user's `disable-model-invocation: true` in the shared
   * tree was silently re-advertised as model-invocable. */
  modelInvocable?: boolean
  /** Whether catalog skills are advertised/loadable from user surfaces
   * (per-skill `user-invocable` frontmatter overrides — see modelInvocable). */
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
  // v31 CAT-01: warn-once per DISTINCT scan failure (consults repeat per turn).
  let lastScanWarn = ''
  // OPT-10 (2026-09): per-skill invocation policy parsed from the SAME
  // frontmatter keys the shadowed upstream provider reads
  // (`disable-model-invocation` / `user-invocable`). Upstream THROWS on the
  // legacy/misspelled keys and on non-boolean values; the shadow WARNS ONCE
  // and falls back to the row default instead — a malformed frontmatter file
  // must not break the whole catalog scan (same posture as CAT-01).
  let invocationCache: Map<string, SkillInvocationPolicy> | null = null
  const warnedFrontmatter = new Set<string>()
  const warnFrontmatterOnce = (name: string, key: string, detail: string): void => {
    const slot = `${name}:${key}`
    if (warnedFrontmatter.has(slot)) return
    warnedFrontmatter.add(slot)
    ctx.logger.warn(`evolution-skill-catalog: "${name}" frontmatter ${detail}`)
  }
  const frontmatterBool = (name: string, data: Record<string, unknown>, key: string): boolean | undefined => {
    if (!Object.hasOwn(data, key)) return undefined
    const value = data[key]
    if (typeof value === 'boolean') return value
    if (value === 1 || value === '1') return true
    if (value === 0 || value === '0') return false
    if (typeof value === 'string') {
      const lowered = value.toLowerCase()
      if (lowered === 'true' || lowered === 'yes' || lowered === 'on') return true
      if (lowered === 'false' || lowered === 'no' || lowered === 'off') return false
    }
    warnFrontmatterOnce(name, key, `"${key}" must be a boolean; the row-level default applies until fixed`)
    return undefined
  }
  const invocationFromFrontmatter = (name: string, data: Record<string, unknown>): SkillInvocationPolicy => {
    // Upstream rejects these legacy/alias keys outright; the mirror never
    // accepted them either (they are NOT the row config), so a file carrying
    // one is authoring drift worth one warn.
    for (const legacy of ['disableModelInvocation', 'modelInvocable', 'userInvocable'] as const) {
      if (Object.hasOwn(data, legacy)) warnFrontmatterOnce(name, legacy, `field "${legacy}" is not accepted by the upstream registry; use the canonical kebab key`)
    }
    const disableModel = frontmatterBool(name, data, 'disable-model-invocation')
    const user = frontmatterBool(name, data, 'user-invocable')
    // Per-FIELD override: a frontmatter key the file does not set falls back
    // to the ROW-level default (which upstream models as its constant `true`).
    return {
      modelInvocable: disableModel !== undefined ? !disableModel : invocation.modelInvocable,
      userInvocable: user !== undefined ? user : invocation.userInvocable,
    }
  }
  async function summaries(): Promise<SkillSummary[]> {
    const stamp = await io.mtime?.(library.root) ?? null
    if (summariesCache !== null && (stamp === null || summariesStamp === stamp)) return summariesCache
    if (summariesCache !== null && stamp !== null) control?.invalidate()
    const epochAtScanStart = summariesEpoch
    // v31 CAT-01: a loud read failure on ONE SKILL.md (EACCES — the REG-01
    // posture) must not abort the whole platform collection: this provider is
    // called OUTSIDE any try/catch, so the throw used to kill agent/pre-step
    // and the skill tool for the entire session. Degrade to the last coherent
    // cache (or empty) with a warn; the cache is not assigned, so the next
    // successful scan repopulates normally.
    let scanned: SkillSummary[]
    try {
      scanned = await library.list()
    } catch (error) {
      const message = `skill tree scan failed (${error instanceof Error ? error.message : String(error)}) — serving ${summariesCache?.length ?? 0} cached summaries`
      if (lastScanWarn !== message) {
        lastScanWarn = message
        ctx.logger.warn(`evolution-skill-catalog: ${message}`)
      }
      return summariesCache ?? []
    }
    if (lastScanWarn !== '') {
      // v31 CAT-02: recovery after a degraded consult — the registry cached
      // the empty fallback, and the invalidate gate below requires a non-null
      // cache, which a recovery scan does not have. Re-arm the registry here
      // so it re-consults and picks up the repopulated list.
      control?.invalidate()
      lastScanWarn = ''
    }
    // OPT-10: rebuild the per-skill invocation map alongside the scan — one
    // extra SKILL.md read per skill, and scans only run on mutation/refresh/
    // first-consult. A file whose frontmatter cannot be parsed keeps the row
    // default (absent from the map), same posture as its description.
    const invocationMap = new Map<string, SkillInvocationPolicy>()
    for (const summary of scanned) {
      const raw = await io.readText(join(summary.path, 'SKILL.md')).catch(() => null)
      if (raw === null) continue
      const parsed = parseFrontmatter(raw)
      if (!parsed) continue
      invocationMap.set(summary.name, invocationFromFrontmatter(summary.name, parsed.frontmatter))
    }
    invocationCache = invocationMap
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
    invocationCache = null
    control?.invalidate()
  }
  // OPT-10: the row-level policy is the FALLBACK — a per-skill frontmatter
  // policy wins for that skill (absent entry = unparseable/unreadable file).
  const invocationFor = (name: string): SkillInvocationPolicy => invocationCache?.get(name) ?? invocation

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
        invocation: invocationFor(summary.name),
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
      const raw = await library.read(name)
      if (raw === null) return undefined
      // V27 G5.3: the upstream filesystem provider publishes the BODY
      // (`skill-filesystem`: `content: parsed.body.trim()`). This provider
      // shadows it for the same skills, so publishing the whole file made the
      // model see a different skill depending on which provider served it — the
      // frontmatter block leaked into the content the model loads. A file whose
      // frontmatter cannot be read keeps its raw text: this provider's job is to
      // keep the skill visible, and the audit already flags such a file
      // (`frontmatterCatalogInvalid`).
      const content = parseFrontmatter(raw)?.body ?? raw
      return {
        name,
        description: summary.description,
        ...summary.whenToUse !== undefined ? { whenToUse: summary.whenToUse } : {},
        invocation: invocationFor(name),
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
