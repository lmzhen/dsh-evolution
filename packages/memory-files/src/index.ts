/**
 * Local layered memory provider for `ctx.memory`.
 * @module @deepseek-ai/dsh-memory-files
 */

import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_CONSOLIDATION_FAILURES, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_USER_CHAR_LIMIT, evolutionIoAdapter, makeSerialQueue, MemoryStore, clampedNumber } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-io'
import type { MemoryOperation, MemoryProvider, MemorySnapshot, MemoryTarget } from '@deepseek-ai/dsh-memory'

export const name = 'memory-files'
export const inject = ['memory', 'evolutionIo']

export interface Config {
  providerName?: string
  /** Store-enforced character budget for MEMORY.md. The policy row's
   * `memoryChars` is the same semantic on the review-planner side and is the
   * canonical id (G0/S0.2); the two are NOT auto-synchronised —
   * `/evolution doctor` reports the divergence (budgetIssues). Deprecated alias
   * (G0/S0.3): still readable, refused by writes; removed in 0.7.0. */
  memoryCharLimit?: number
  /** Store-enforced character budget for USER.md; the canonical id is the policy
   * row's `userChars`. Divergence is reported by `/evolution doctor`. Deprecated
   * alias (G0/S0.3): still readable, refused by writes; removed in 0.7.0. */
  userCharLimit?: number
  addDatePrefix?: boolean
  root?: string
  /** How many consolidation failures one turn tolerates before the tool tells the model to stop retrying. */
  maxConsolidationFailures?: number
  /** F-2 (v18): deployment-declared benign threat labels for the MEMORY store.
   * The skill/guard channels already read this option; without it the
   * README's "MemoryStore store option" exemption was unreachable. */
  threatExemptLabels?: string[]
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('files'),
  memoryCharLimit: z.number().min(1).default(DEFAULT_MEMORY_CHAR_LIMIT),
  userCharLimit: z.number().min(1).default(DEFAULT_USER_CHAR_LIMIT),
  addDatePrefix: z.boolean().default(false),
  root: z.string().default(''),
  maxConsolidationFailures: z.number().min(1).default(DEFAULT_CONSOLIDATION_FAILURES),
  threatExemptLabels: z.array(z.string()).default([]),
})

export function apply(ctx: Context, rawConfig: Config = {}): void {
  // G3.1 (0.3.23): clamp the numeric memory limit at assembly so a 0/negative/
  // NaN/±Infinity value falls back to the package default. A 0 limit is never an
  // "unbounded" meaning (MemoryStore keeps its own internal defense); the schema
  // `.min(1)` rejects 0/negative at load, this clamp also covers NaN/±Infinity
  // (which schemastery lets a bare number schema through) and direct
  // construction. Warn once when a user-supplied value had to be corrected.
  const clamped: string[] = []
  const field = (name: string, value: number | undefined, fallback: number): number => {
    const result = clampedNumber(value, fallback, { min: 1 })
    if (value !== undefined && result !== value) clamped.push(name)
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
  const budget = policyBudget()
  // The loader fills SCHEMA DEFAULTS into the row config, so `undefined` never
  // arrives here — "the operator set this" has to be read as "differs from the
  // schema default", the same test the review row uses for shadowed fields. A
  // row that pins the default value explicitly is therefore indistinguishable
  // from one that leaves it unset, and follows the policy like the latter.
  const schemaDefaults = (Config as unknown as { ['~standard']: { validate(input: unknown): { value: Config } } })['~standard'].validate({}).value
  const explicitLimit = (name: 'memoryCharLimit' | 'userCharLimit'): boolean =>
    rawConfig[name] !== undefined && rawConfig[name] !== schemaDefaults[name]
  const config = Object.assign({}, rawConfig, {
    memoryCharLimit: floorLimit(field('memoryCharLimit', explicitLimit('memoryCharLimit') ? rawConfig.memoryCharLimit : budget.memory, DEFAULT_MEMORY_CHAR_LIMIT)),
    userCharLimit: floorLimit(field('userCharLimit', explicitLimit('userCharLimit') ? rawConfig.userCharLimit : budget.user, DEFAULT_USER_CHAR_LIMIT)),
    maxConsolidationFailures: field('maxConsolidationFailures', rawConfig.maxConsolidationFailures, DEFAULT_CONSOLIDATION_FAILURES),
  }) as Required<Config>
  if (clamped.length > 0) {
    ctx.logger.warn(`memory-files: ${clamped.join(', ')} provided an invalid value; falling back to the default`)
  }
  // The one disagreement this plugin can see at load: an EXPLICIT config value
  // that contradicts the mounted policy. Doctor re-checks the same pair at run
  // time (it can see the policy mount that happened after this row).
  if (explicitLimit('memoryCharLimit') && budget.memory !== undefined && config.memoryCharLimit !== budget.memory) {
    ctx.logger.warn(`memory-files: memoryCharLimit=${config.memoryCharLimit} contradicts evolution-policy memoryChars=${budget.memory} — the store enforces the row value while the review plans against the policy value; align them or leave the row unset`)
  }
  if (explicitLimit('userCharLimit') && budget.user !== undefined && config.userCharLimit !== budget.user) {
    ctx.logger.warn(`memory-files: userCharLimit=${config.userCharLimit} contradicts evolution-policy userChars=${budget.user} — same divergence as memoryCharLimit`)
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
  const trimmedRoot = (config.root || '').trim()
  const resolvedRoot = trimmedRoot === '' ? '' : resolve(trimmedRoot)
  const store = new MemoryStore({
    memoryCharLimit: config.memoryCharLimit,
    userCharLimit: config.userCharLimit,
    addDatePrefix: config.addDatePrefix,
    maxConsolidationFailures: config.maxConsolidationFailures,
    // F-2 (v18): the memory store's own exemption list, now configurable.
    threatExemptLabels: config.threatExemptLabels,
    ...resolvedRoot !== '' ? { root: resolvedRoot } : {},
    io,
  })
  const provider: MemoryProvider = {
    name: config.providerName,
    read: (target: MemoryTarget) => store.read(target),
    applyBatch: async (target: MemoryTarget, operations: MemoryOperation[]) => {
      const normalized = operations.map(op => ({ action: op.action, facts: op.facts ?? op.content, old_text: op.old_text }))
      return await serializedWrite(() => store.applyBatch(target, normalized))
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
      const [memory, user] = await serializedWrite(async () => [
        await store.read('memory'),
        await store.read('user'),
      ])
      const text = JSON.stringify([memory, user])
      return { version: 1, sha256: createHash('sha256').update(text).digest('hex'), memory, user }
    },
    // P2-3 (v14): the SAME single-generation rule as `snapshot` — this is the
    // path the model actually reads (tool-memory injects `renderContext`), and
    // it read memory and user as two independent awaits, so a concurrent
    // applyBatch could land between them and produce a mixed-generation
    // context. Queue both reads as one serialized step.
    renderContext: () => serializedWrite(() => store.renderContext()),
  }
  // S2-12③: publish the EFFECTIVE budget so doctor can compare the two surfaces
  // at run time (the same one-writer/one-reader contract as evolutionFeedback /
  // evolutionReplay). `source` names which surface won at load.
  ctx.provide('evolutionMemoryBudget', {
    memoryCharLimit: config.memoryCharLimit,
    userCharLimit: config.userCharLimit,
    memorySource: explicitLimit('memoryCharLimit') ? 'config' : (budget.memory === undefined ? 'default' : 'policy'),
    userSource: explicitLimit('userCharLimit') ? 'config' : (budget.user === undefined ? 'default' : 'policy'),
    policyMemoryChars: budget.memory,
    policyUserChars: budget.user,
  })
  ctx.effect(() => ctx.memory.registerProvider(provider), 'memory-files.provider')
}

