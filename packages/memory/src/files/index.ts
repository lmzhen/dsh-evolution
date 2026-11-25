/**
 * Local layered memory provider for `ctx.memory`.
 * @module @deepseek-ai/dsh-memory-files
 */

import { settingsPort } from '@deepseek-ai/dsh-evolution-platform/ports'
import { evolutionHome, liveHomeFence, liveStoreService, memoryIoIfV2, memoryRoot } from '@deepseek-ai/dsh-evolution-core'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_CONSOLIDATION_FAILURES, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_USER_CHAR_LIMIT, DEFAULT_MEMORY_TOKENS, DEFAULT_USER_TOKENS, UPSTREAM_LIMIT_CHARS_PER_TOKEN, paramRowId, payloadText, userSetKeys, evolutionIoAdapter, makeSerialQueue, MemoryStore, clampOnce, liveBool, unwrapLive } from '@deepseek-ai/dsh-evolution-core'
import type { LiveValue, MemoryStoreOptions } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-core/io-registry'
import type { MemoryOperation, MemoryProvider, MemorySnapshot, MemoryTarget } from '../index.ts'

export const name = 'memory-files'
export const inject = ['memory', 'evolutionIo']

export interface Config {
  providerName?: string
  /** Store-enforced character budget for MEMORY.md — the CANONICAL registry id
   * (G1) and a LIVE row field (registry tier E3). G0/S0.3: the removed live-row
   * alias `memoryCharLimit` is migration/doctor input only. The policy row's `memoryChars`
   * is the same semantic on the review-planner side; the two are NOT
   * auto-synchronised — `/evolution doctor` reports the divergence (budgetIssues).
   * This is the only row key in 0.48; the store resolves
   * DEFAULT_MEMORY_CHAR_LIMIT when the row carries nothing. */
  memoryChars?: Volatile<number | undefined>
  /** Opt-in token budgets; when present they win over the legacy char budgets. */
  memoryTokens?: Volatile<number | undefined>
  /** Store-enforced character budget for USER.md — the CANONICAL registry id (G1),
   * a live row field on the same terms as `memoryChars`. G0/S0.3: `userCharLimit`
   * is migration/doctor input only. */
  userChars?: Volatile<number | undefined>
  /** Opt-in USER.md token budget; when present it wins over `userChars`. */
  userTokens?: Volatile<number | undefined>
  addDatePrefix?: Volatile<boolean>
  root?: string
  /** How many consolidation failures one turn tolerates before the tool tells the model to stop retrying. */
  maxConsolidationFailures?: Volatile<number>
  /** F-2 (v18): deployment-declared benign threat labels for the MEMORY store.
   * The skill/guard channels already read this option; without it the
   * README's "MemoryStore store option" exemption was unreachable. */
  threatExemptLabels?: string[]
}

// G1: the four E3 keys of this row carry `.volatile()`, so the platform hands the
// plugin a stable reference it updates in place and the settings surface can edit
// them live. The schema keeps NO annotation: a volatile field's output is a
// reference, which the annotated `z<Config>` reading cannot express (TS2375) — the
// platform's own volatile rows are unannotated for the same reason.
export const Config = z.object({
  providerName: z.string().default('files'),
  // The canonical registry ids. No .default(): the store resolves
  // DEFAULT_MEMORY_CHAR_LIMIT / DEFAULT_USER_CHAR_LIMIT when the row carries nothing.
  memoryChars: z.number().min(1).volatile(),
  userChars: z.number().min(1).volatile(),
  memoryTokens: z.number().min(1).volatile(),
  userTokens: z.number().min(1).volatile(),
  addDatePrefix: z.boolean().default(false).volatile(),
  root: z.string().default(''),
  maxConsolidationFailures: z.number().min(1).default(DEFAULT_CONSOLIDATION_FAILURES).volatile(),
  threatExemptLabels: z.array(z.string()).default([]),
})

export function apply(ctx: Context, rawConfig: Config = {}): void {

  // G1: suppress the platform's auto-generated settings page for this row (the
  // family renders its own card from the registry). Probed, not assumed: a host
  // without the capability still loads.
  ctx.inject(['settings'], (injected) => {
    const settings = settingsPort(injected)
    if (settings?.configure === undefined) return
    // v46 S1.12b (finding 6-1): the owner argument is what the platform looks the presentation up by.
    // Omitting it registers the suppression on the settings service's own fiber, so a row that
    // re-mounts keeps a dead key and the auto form can return (platform precedent:
    // settings.configure({ auto: false }, plugin.fiber) — settings/src/index.ts:266).
    const disposer = settings.configure({ auto: false }, ctx.fiber)
    if (typeof disposer === 'function') ctx.effect(() => disposer as () => void, 'memory-files: settings presentation')
  })
  // G3.1 (0.3.23): clamp the numeric memory limit so a 0/negative/NaN/±Infinity
  // value falls back to the package default. A 0 limit is never an "unbounded"
  // meaning (MemoryStore keeps its own internal defense); the schema `.min(1)`
  // rejects 0/negative at load, this clamp also covers NaN/±Infinity (which
  // schemastery lets a bare number schema through) and direct construction.
  // G1 §8.3: every read happens at USE time, so the correction warns once per KEY
  // per mount instead of once at assembly.
  const clampedKeys = new Set<string>()
  /**
   * Clamp one supplied numeric value, warning once per key.
   * @param name - the config key, for the warning.
   * @param value - the value as supplied by the deployment or the user.
   * @param fallback - the package default a corrected value falls back to.
   * @returns the value the store may use.
   */
  const field = (name: string, value: LiveValue<number>, fallback: number): number =>
    clampOnce(clampedKeys, (message) => { ctx.logger.warn(message) }, `memory-files: ${name}`, value, fallback, 1)
  // P2-23 (v37): a fractional char limit reached the store unchanged, and the
  // tool surface declares `limit` as an integer — every memory call then failed
  // platform output validation AFTER the write had landed. The char limit is a
  // counted quantity, so it is floored at the one point where it enters the store
  // (floor, not round: a limit must never grow past what the operator configured).
  const floorLimit = (value: number): number => Math.floor(value)
  // S2-12③ (FLOW5-4): the memory budget has TWO configuration surfaces — this
  // package's `memoryCharLimit`/`userCharLimit` (what the STORE enforces) and
  // `evolution-policy`'s `memoryChars`/`userChars` (what the review pipeline
  // PLANS against). They used to default independently, so moving one left the
  // other behind: the reviewer planned ops for a budget the store then refused.
  // Explicit config still wins (the operator said so); an UNSET limit follows the
  // policy when that service is already mounted, and otherwise keeps the default
  // (row order is not something this plugin can force — doctor compares the two
  // surfaces again at run time and flags a disagreement, including the
  // order-induced one).
  const policySnapshot = (): { memoryChars?: number; userChars?: number; memoryTokens?: number; userTokens?: number } | undefined => {
    const policy = ctx.get('evolutionPolicy') as { get?: () => { memoryChars?: number; userChars?: number; memoryTokens?: number; userTokens?: number } } | undefined
    return policy?.get?.()
  }
  const policyTokens = (): { memory: number | undefined; user: number | undefined } => {
    const snapshot = policySnapshot()
    return {
      memory: snapshot?.memoryTokens
        ?? (snapshot?.memoryChars === undefined ? undefined : Math.round(snapshot.memoryChars / UPSTREAM_LIMIT_CHARS_PER_TOKEN)),
      user: snapshot?.userTokens
        ?? (snapshot?.userChars === undefined ? undefined : Math.round(snapshot.userChars / UPSTREAM_LIMIT_CHARS_PER_TOKEN)),
    }
  }
  const DEFAULTS = { memoryChars: DEFAULT_MEMORY_CHAR_LIMIT, userChars: DEFAULT_USER_CHAR_LIMIT } as const
  /**
   * The live value of one canonical budget key (G1 §8.3).
   * @param id - the canonical registry id.
   * @returns the value the platform resolved (user layer included), or undefined.
   */
  const canonicalBudget = (id: 'memoryChars' | 'userChars'): number | undefined =>
    unwrapLive(id === 'memoryChars' ? rawConfig.memoryChars : rawConfig.userChars)
  /** The explicitly configured opt-in token budget, if any. */
  const canonicalTokenBudget = (id: 'memoryTokens' | 'userTokens'): number | undefined =>
    unwrapLive(id === 'memoryTokens' ? rawConfig.memoryTokens : rawConfig.userTokens)
  /**
   * The token budget the store should use. A row-level char value is an explicit
   * legacy override and keeps char mode; otherwise the row token value wins over
   * the policy token value, which wins over the token default.
   */
  const effectiveTokenLimit = (id: 'memoryTokens' | 'userTokens'): number | undefined => {
    const rowToken = canonicalTokenBudget(id)
    if (rowToken !== undefined) return rowToken
    const rowChar = canonicalBudget(id === 'memoryTokens' ? 'memoryChars' : 'userChars')
    if (rowChar !== undefined) return undefined
    const policy = policyTokens()
    const policyToken = id === 'memoryTokens' ? policy.memory : policy.user
    return policyToken ?? (id === 'memoryTokens' ? DEFAULT_MEMORY_TOKENS : DEFAULT_USER_TOKENS)
  }
  /**
   * Whether the OPERATOR set this budget on THIS ROW (G0/S0.4 + G1). The canonical
   * key answers through its live reference — a user-layer value arrives the same
   * way, which is what keeps a user choice ahead of the policy.
   * @param id - the canonical registry id.
   * @returns whether the row or the user supplied a value.
   */
  const explicitBudget = (id: 'memoryChars' | 'userChars'): boolean => canonicalBudget(id) !== undefined
  /**
   * The budget one key resolves to (G1 §8.4-A): the row's own canonical value over
   * the mounted policy, over the package default.
   * @param id - the canonical registry id.
   * @returns the resolved, unclamped budget.
   */
  const budget = (id: 'memoryChars' | 'userChars'): number => {
    const explicit = canonicalBudget(id)
    if (explicit !== undefined) return explicit
    const policy = policySnapshot()
    return (id === 'memoryChars' ? policy?.memoryChars : policy?.userChars) ?? DEFAULTS[id]
  }
  // One resolved number feeds the store, the budget view and doctor.
  const memoryChars = (): number => floorLimit(field('memoryChars', budget('memoryChars'), DEFAULT_MEMORY_CHAR_LIMIT))
  const userChars = (): number => floorLimit(field('userChars', budget('userChars'), DEFAULT_USER_CHAR_LIMIT))
  const consolidationFailures = (): number => field('maxConsolidationFailures', rawConfig.maxConsolidationFailures, DEFAULT_CONSOLIDATION_FAILURES)
  const addDatePrefix = (): boolean => liveBool(rawConfig.addDatePrefix)
  // The one disagreement this plugin can see at load: an EXPLICIT row value that
  // contradicts the mounted policy. Doctor re-checks the same pair at run time (it
  // can see the policy mount that happened after this row).
  const policyAtMount = policySnapshot()
  if (explicitBudget('memoryChars') && policyAtMount?.memoryChars !== undefined && memoryChars() !== policyAtMount.memoryChars) {
    ctx.logger.warn(`memory-files: the row's memoryChars=${memoryChars()} contradicts evolution-policy memoryChars=${policyAtMount.memoryChars} — the store enforces the row value while the review plans against the policy value; align them or leave the row unset`)
  }
  if (explicitBudget('userChars') && policyAtMount?.userChars !== undefined && userChars() !== policyAtMount.userChars) {
    ctx.logger.warn(`memory-files: the row's userChars=${userChars()} contradicts evolution-policy userChars=${policyAtMount.userChars} — same divergence as memoryChars`)
  }
  // The IO provider is resolved lazily so `memory-files` does not depend on
  // row order: the first write happens only after the preset has fully mounted.
  const io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
  // In-process write serialization: applyBatch is read-modify-write, so two
  // concurrent callers (multi-session host) can otherwise compute on the same
  // old entries and the last rename wins, silently dropping the other's ops.
  // 0.3.17 (S2.8, T-1): the queue factory is shared with state-json now.
  const serializedWrite = makeSerialQueue()
  // V5-11 (0.3.32): a whitespace-only `root` was truthy and resolved to a
  // CWD-relative path — trim like resolveSkillsRoot/state-json (V4-09 third
  // occurrence); empty/whitespace both fall through to the default root.
  // PLAN S2.2-adjacent P2-31 (2026-09-16): an EXPLICIT non-empty root is now
  // run through resolve() — the same standard as core's evolutionRoot
  // (state-store.ts) — so the store root is pinned to an absolute path at
  // mount instead of staying CWD-relative and letting every io call land
  // wherever the process CWD points at that moment. Empty/whitespace keeps
  // the memoryRoot() default unchanged.
  const trimmedRoot = (rawConfig.root || '').trim()
  const resolvedRoot = trimmedRoot === '' ? '' : resolve(trimmedRoot)
  // G3/S3.2 + G1: the user layer and the deployment carriers both land in the four
  // live values above, so the store is DERIVED from them rather than kept in step
  // by a settings hook. `MemoryStore` reads its limits in its CONSTRUCTOR, so an
  // option set that changed since the last operation rebuilds it — registration-
  // level facts, the one thing the platform's `onChange` hook existed for. A
  // rebuild resets the store's consolidation-failure counter; the previous hook
  // rebuilt on ANY committed change, so this fires strictly less often. One
  // operation takes one store (the read/write pair inside `snapshot` must not
  // straddle a rebuild), and the write queue lives outside the store either way.
  let store: MemoryStore | undefined
  let storeKey = ''
  /**
   * The store for the configuration as it stands right now.
   * @returns the current store, rebuilt when a resolved limit changed.
   */
  const currentStore = (): MemoryStore => {
    const memoryTokenLimit = effectiveTokenLimit('memoryTokens')
    const userTokenLimit = effectiveTokenLimit('userTokens')
    const options: Pick<MemoryStoreOptions, 'memoryCharLimit' | 'userCharLimit' | 'memoryTokenLimit' | 'userTokenLimit' | 'addDatePrefix' | 'maxConsolidationFailures'> = {
      memoryCharLimit: memoryChars(),
      userCharLimit: userChars(),
      ...(memoryTokenLimit === undefined ? {} : { memoryTokenLimit }),
      ...(userTokenLimit === undefined ? {} : { userTokenLimit }),
      addDatePrefix: addDatePrefix(),
      maxConsolidationFailures: consolidationFailures(),
    }
    const key = JSON.stringify(options)
    if (store !== undefined && key === storeKey) return store
    const fence = liveHomeFence(ctx as unknown as { get(name: string): unknown }, evolutionHome())
    const storeIo = memoryIoIfV2(ctx, io, evolutionHome(), resolvedRoot !== '' ? resolvedRoot : memoryRoot(), fence, liveStoreService(ctx)) ?? io
    store = new MemoryStore({
      ...options,
      // F-2 (v18): the memory store's own exemption list, now configurable.
      ...rawConfig.threatExemptLabels !== undefined ? { threatExemptLabels: rawConfig.threatExemptLabels } : {},
      ...resolvedRoot !== '' ? { root: resolvedRoot } : {},
      io: storeIo,
      ...(fence === undefined ? {} : { fence }),
    })
    storeKey = key
    return store
  }
  const provider: MemoryProvider = {
    name: rawConfig.providerName ?? 'files',
    read: (target: MemoryTarget) => currentStore().read(target),
    applyBatch: async (target: MemoryTarget, operations: MemoryOperation[]) => {
      // T3-06/A34: the payload alias is resolved by core's ONE rule, so this
      // provider cannot disagree with the validator or the store about a blank
      // `facts` sitting next to a real `content`.
      const normalized = operations.map(op => ({ action: op.action, facts: payloadText(op), old_text: op.old_text }))
      return await serializedWrite(() => currentStore().applyBatch(target, normalized))
    },
    snapshot: async (): Promise<MemorySnapshot> => {
      // 0.3.17 (E-73): serial reads — a concurrent write between the two
      // Promise.all reads used to produce a mixed-generation snapshot. V4-12:
      // reading memory and user as two separate awaited reads still lets a
      // serializedWrite (an applyBatch) yield BETWEEN them, so the two reads
      // now run inside one serializedWrite task: no write can interleave, the
      // snapshot is a single generation, and the sha256 pins a state that truly
      // existed. (The cross-process window is documented as accepted — the
      // single-process chain is this family's second layer.)
      const [memory, user] = await serializedWrite(async () => {
        const current = currentStore()
        return [await current.read('memory'), await current.read('user')]
      })
      const text = JSON.stringify([memory, user])
      return { version: 1, sha256: createHash('sha256').update(text).digest('hex'), memory, user }
    },
    // P2-3 (v14): the SAME single-generation rule as `snapshot` — this is the
    // path the model actually reads (tool-memory injects `renderContext`), and
    // it read memory and user as two independent awaits, so a concurrent
    // applyBatch could land between them and produce a mixed-generation
    // context. Queue both reads as one serialized step.
    renderContext: () => serializedWrite(() => currentStore().renderContext()),
  }
  // S2.9 (T3-10): the settings user-layer KEY read is ONE core function (`userSetKeys`); this row
  // only names its own namespace. The review, curator and skill rows call the same reader.
  /**
   * Which surface supplied one budget.
   * @param id - the canonical registry id.
   * @returns 'user', 'config', 'policy' or 'default'.
   */
  const limitSource = (id: 'memoryChars' | 'userChars'): string => {
    if (userSetKeys(ctx, paramRowId('memory-files')).has(id)) return 'user'
    if (explicitBudget(id)) return 'config'
    const policy = policySnapshot()
    return (id === 'memoryChars' ? policy?.memoryChars : policy?.userChars) === undefined ? 'default' : 'policy'
  }
  // S2-12③: publish the EFFECTIVE budget so doctor can compare the two surfaces
  // at run time (the same one-writer/one-reader contract as evolutionFeedback /
  // evolutionReplay). Every member is a LIVE VIEW (G1 §8.3): the user layer can
  // change at run time, and a policy mounted after this row is visible too.
  // `source` names the winning surface; 'user' is the highest-priority one.
  ctx.provide('evolutionMemoryBudget', {
    get memoryChars(): number { return memoryChars() },
    get userChars(): number { return userChars() },
    get memoryTokens(): number | undefined { return effectiveTokenLimit('memoryTokens') },
    get userTokens(): number | undefined { return effectiveTokenLimit('userTokens') },
    get memorySource(): string { return limitSource('memoryChars') },
    get userSource(): string { return limitSource('userChars') },
    get memoryTokenSource(): string {
      if (userSetKeys(ctx, paramRowId('memory-files')).has('memoryTokens')) return 'user'
      if (canonicalTokenBudget('memoryTokens') !== undefined) return 'config'
      const rowChar = canonicalBudget('memoryChars')
      if (rowChar !== undefined) return 'legacy-char'
      return policySnapshot()?.memoryTokens === undefined && policySnapshot()?.memoryChars === undefined ? 'default' : 'policy'
    },
    get userTokenSource(): string {
      if (userSetKeys(ctx, paramRowId('memory-files')).has('userTokens')) return 'user'
      if (canonicalTokenBudget('userTokens') !== undefined) return 'config'
      const rowChar = canonicalBudget('userChars')
      if (rowChar !== undefined) return 'legacy-char'
      return policySnapshot()?.userTokens === undefined && policySnapshot()?.userChars === undefined ? 'default' : 'policy'
    },
    get policyMemoryChars(): number | undefined { return policySnapshot()?.memoryChars },
    get policyUserChars(): number | undefined { return policySnapshot()?.userChars },
    get policyMemoryTokens(): number | undefined { return policyTokens().memory },
    get policyUserTokens(): number | undefined { return policyTokens().user },
  })
  ctx.effect(() => ctx.memory.registerProvider(provider), 'memory-files.provider')
}

