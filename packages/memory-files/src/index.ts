/**
 * Local layered memory provider for `ctx.memory`.
 * @module @deepseek-ai/dsh-memory-files
 */

import type { Context, Fiber, Volatile } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_CONSOLIDATION_FAILURES, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_USER_CHAR_LIMIT, paramRowId, evolutionIoAdapter, makeSerialQueue, MemoryStore, clampedNumber } from '@deepseek-ai/dsh-evolution-core'
import type { MemoryStoreOptions } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-io'
import type { MemoryOperation, MemoryProvider, MemorySnapshot, MemoryTarget } from '@deepseek-ai/dsh-memory'

export const name = 'memory-files'
export const inject = ['memory', 'evolutionIo']

export interface Config {
  providerName?: string
  /** Store-enforced character budget for MEMORY.md — the CANONICAL registry id
   * (G1) and a LIVE row field (registry tier E3). The policy row's `memoryChars`
   * is the same semantic on the review-planner side; the two are NOT
   * auto-synchronised — `/evolution doctor` reports the divergence (budgetIssues).
   * A row may spell either this name or the deprecated alias below. No schema
   * default: the alias carries it, and a default on the canonical key would fill
   * it and leave the alias unreachable (the store resolves
   * DEFAULT_MEMORY_CHAR_LIMIT after the alias fallback). */
  memoryChars?: Volatile<number | undefined>
  /** Store-enforced character budget for USER.md — the CANONICAL registry id (G1),
   * a live row field on the same terms as `memoryChars`. */
  userChars?: Volatile<number | undefined>
  /** Deprecated alias of `memoryChars` (G0/S0.3): still readable, refused by
   * writes; removed in 0.7.0. */
  memoryCharLimit?: number
  /** Deprecated alias of `userChars` (G0/S0.3): still readable, refused by
   * writes; removed in 0.7.0. */
  userCharLimit?: number
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
  // The canonical registry ids. No .default() on either one: a schema default would
  // fill the canonical key and make the deprecated alias below unreachable through
  // the store's alias fallback (DEFAULT_MEMORY_CHAR_LIMIT /
  // DEFAULT_USER_CHAR_LIMIT are resolved there).
  memoryChars: z.number().min(1).volatile(),
  userChars: z.number().min(1).volatile(),
  memoryCharLimit: z.number().min(1).default(DEFAULT_MEMORY_CHAR_LIMIT),
  userCharLimit: z.number().min(1).default(DEFAULT_USER_CHAR_LIMIT),
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
    const settings = (injected as { settings?: { configure?: (presentation: { auto?: boolean }, owner?: Fiber) => unknown } }).settings
    if (typeof settings?.configure !== 'function') return
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
   * One live numeric row field as the platform resolved it.
   * @param value - the field, or its volatile reference.
   * @returns the current plain value, or undefined when nothing supplied one.
   */
  const liveNumber = (value: number | Volatile<number | undefined> | undefined): number | undefined =>
    typeof value === 'object' ? value.get() : value
  /**
   * Clamp one supplied numeric value, warning once per key.
   * @param name - the config key, for the warning.
   * @param value - the value as supplied by the deployment or the user.
   * @param fallback - the package default a corrected value falls back to.
   * @returns the value the store may use.
   */
  const field = (name: string, value: number | Volatile<number | undefined> | undefined, fallback: number): number => {
    const current = liveNumber(value)
    const result = clampedNumber(current, fallback, { min: 1 })
    if (current !== undefined && result !== current && !clampedKeys.has(name)) {
      clampedKeys.add(name)
      ctx.logger.warn(`memory-files: ${name} provided an invalid value; falling back to the default`)
    }
    return result
  }
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
  const policyBudget = (): { memory: number | undefined; user: number | undefined } => {
    const policy = ctx.get('evolutionPolicy') as { get?: () => { memoryChars?: number; userChars?: number } } | undefined
    const snapshot = policy?.get?.()
    return { memory: snapshot?.memoryChars, user: snapshot?.userChars }
  }
  // The row fills SCHEMA DEFAULTS into the deprecated alias, so "the operator set
  // the alias" is read as "differs from that default" — the same test the review
  // row uses for shadowed fields. A row that pins the alias default is therefore
  // indistinguishable from one that omits it, and follows the policy like the
  // latter.
  const aliasDefaults = (Config as unknown as { ['~standard']: { validate(input: unknown): { value: Record<'memoryCharLimit' | 'userCharLimit', number> } } })['~standard'].validate({}).value
  const ALIAS_OF = { memoryChars: 'memoryCharLimit', userChars: 'userCharLimit' } as const
  const DEFAULTS = { memoryChars: DEFAULT_MEMORY_CHAR_LIMIT, userChars: DEFAULT_USER_CHAR_LIMIT } as const
  /**
   * The live value of one canonical budget key (G1 §8.3).
   * @param id - the canonical registry id.
   * @returns the value the platform resolved (user layer included), or undefined.
   */
  const canonicalBudget = (id: 'memoryChars' | 'userChars'): number | undefined =>
    liveNumber(id === 'memoryChars' ? rawConfig.memoryChars : rawConfig.userChars)
  /**
   * Whether the OPERATOR set this budget on THIS ROW (G0/S0.4 + G1).
   *
   * The canonical key answers through its live reference — a user-layer value
   * arrives the same way, which is what keeps a user choice ahead of the policy —
   * and the deprecated alias through the default comparison above. The pair is
   * documented in the Config JSDoc and reported by /evolution doctor (budgetIssues).
   * @param id - the canonical registry id.
   * @returns whether the row or the user supplied a value.
   */
  const explicitBudget = (id: 'memoryChars' | 'userChars'): boolean => {
    if (canonicalBudget(id) !== undefined) return true
    const alias = rawConfig[ALIAS_OF[id]]
    return alias !== undefined && alias !== aliasDefaults[ALIAS_OF[id]]
  }
  /**
   * The budget one key resolves to (G1 §8.4-A): the row's own value — canonical or
   * alias — over the mounted policy, over the package default.
   * @param id - the canonical registry id.
   * @returns the resolved, unclamped budget.
   */
  const budget = (id: 'memoryChars' | 'userChars'): number => {
    const explicit = canonicalBudget(id) ?? (explicitBudget(id) ? rawConfig[ALIAS_OF[id]] : undefined)
    if (explicit !== undefined) return explicit
    const policy = policyBudget()
    return (id === 'memoryChars' ? policy.memory : policy.user) ?? DEFAULTS[id]
  }
  // BOTH spellings carry the RESOLVED value downstream, so the store, the budget
  // view and the doctor read one number whichever name the deployment wrote.
  const memoryChars = (): number => floorLimit(field('memoryCharLimit', budget('memoryChars'), DEFAULT_MEMORY_CHAR_LIMIT))
  const userChars = (): number => floorLimit(field('userCharLimit', budget('userChars'), DEFAULT_USER_CHAR_LIMIT))
  const consolidationFailures = (): number => field('maxConsolidationFailures', rawConfig.maxConsolidationFailures, DEFAULT_CONSOLIDATION_FAILURES)
  const addDatePrefix = (): boolean => rawConfig.addDatePrefix?.get() ?? false
  // The one disagreement this plugin can see at load: an EXPLICIT row value that
  // contradicts the mounted policy. Doctor re-checks the same pair at run time (it
  // can see the policy mount that happened after this row).
  const policyAtMount = policyBudget()
  if (explicitBudget('memoryChars') && policyAtMount.memory !== undefined && memoryChars() !== policyAtMount.memory) {
    ctx.logger.warn(`memory-files: the row's memoryChars=${memoryChars()} contradicts evolution-policy memoryChars=${policyAtMount.memory} — the store enforces the row value while the review plans against the policy value; align them or leave the row unset`)
  }
  if (explicitBudget('userChars') && policyAtMount.user !== undefined && userChars() !== policyAtMount.user) {
    ctx.logger.warn(`memory-files: the row's userChars=${userChars()} contradicts evolution-policy userChars=${policyAtMount.user} — same divergence as memoryChars`)
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
    const options: Required<Pick<MemoryStoreOptions, 'memoryCharLimit' | 'userCharLimit' | 'addDatePrefix' | 'maxConsolidationFailures'>> = {
      memoryCharLimit: memoryChars(),
      userCharLimit: userChars(),
      addDatePrefix: addDatePrefix(),
      maxConsolidationFailures: consolidationFailures(),
    }
    const key = `${options.memoryCharLimit}|${options.userCharLimit}|${options.addDatePrefix}|${options.maxConsolidationFailures}`
    if (store !== undefined && key === storeKey) return store
    store = new MemoryStore({
      ...options,
      // F-2 (v18): the memory store's own exemption list, now configurable.
      ...rawConfig.threatExemptLabels !== undefined ? { threatExemptLabels: rawConfig.threatExemptLabels } : {},
      ...resolvedRoot !== '' ? { root: resolvedRoot } : {},
      io,
    })
    storeKey = key
    return store
  }
  const provider: MemoryProvider = {
    name: rawConfig.providerName ?? 'files',
    read: (target: MemoryTarget) => currentStore().read(target),
    applyBatch: async (target: MemoryTarget, operations: MemoryOperation[]) => {
      const normalized = operations.map(op => ({ action: op.action, facts: op.facts ?? op.content, old_text: op.old_text }))
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
  /**
   * The keys the user set in this row's namespace (G1 §8.4-A). This is the ONLY
   * remaining read of the settings user layer, and it reads KEY NAMES, never
   * values: the platform resolves the user layer into the row's live fields, so the
   * value comes from `budget` — but naming the winning surface needs to know
   * whether the user set the key at all.
   * @returns the keys present in this row's user layer.
   */
  const userSetKeys = (): ReadonlySet<string> => {
    const settings = ctx.get('settings') as { describe?(options?: { redactSecrets?: boolean }): Array<{ ns: string; user?: Record<string, unknown> }> } | undefined
    const entry = settings?.describe?.({ redactSecrets: false }).find(item => item.ns === paramRowId('memory-files'))
    return new Set(Object.keys(entry?.user ?? {}))
  }
  /**
   * Which surface supplied one budget.
   * @param id - the canonical registry id.
   * @returns 'user', 'config', 'policy' or 'default'.
   */
  const limitSource = (id: 'memoryChars' | 'userChars'): string => {
    if (userSetKeys().has(id)) return 'user'
    if (explicitBudget(id)) return 'config'
    return (id === 'memoryChars' ? policyBudget().memory : policyBudget().user) === undefined ? 'default' : 'policy'
  }
  // S2-12③: publish the EFFECTIVE budget so doctor can compare the two surfaces
  // at run time (the same one-writer/one-reader contract as evolutionFeedback /
  // evolutionReplay). Every member is a LIVE VIEW (G1 §8.3): the user layer can
  // change at run time, and a policy mounted after this row is visible too.
  // `source` names the winning surface; 'user' is the highest-priority one.
  ctx.provide('evolutionMemoryBudget', {
    get memoryCharLimit(): number { return memoryChars() },
    get userCharLimit(): number { return userChars() },
    get memorySource(): string { return limitSource('memoryChars') },
    get userSource(): string { return limitSource('userChars') },
    get policyMemoryChars(): number | undefined { return policyBudget().memory },
    get policyUserChars(): number | undefined { return policyBudget().user },
  })
  ctx.effect(() => ctx.memory.registerProvider(provider), 'memory-files.provider')
}

