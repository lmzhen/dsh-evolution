/**
 * Local layered memory provider for `ctx.memory`.
 * @module @deepseek-ai/dsh-memory-files
 */

import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_CONSOLIDATION_FAILURES, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_USER_CHAR_LIMIT, evolutionIoAdapter, makeSerialQueue, MemoryStore, clampedNumber } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-io'
import type { MemoryOperation, MemoryProvider, MemorySnapshot, MemoryTarget } from '@deepseek-ai/dsh-memory'

export const name = 'memory-files'
export const inject = ['memory', 'evolutionIo']

export interface Config {
  providerName?: string
  memoryCharLimit?: number
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
  const config = Object.assign({}, rawConfig, {
    memoryCharLimit: field('memoryCharLimit', rawConfig.memoryCharLimit, DEFAULT_MEMORY_CHAR_LIMIT),
    userCharLimit: field('userCharLimit', rawConfig.userCharLimit, DEFAULT_USER_CHAR_LIMIT),
    maxConsolidationFailures: field('maxConsolidationFailures', rawConfig.maxConsolidationFailures, DEFAULT_CONSOLIDATION_FAILURES),
  }) as Required<Config>
  if (clamped.length > 0) {
    ctx.logger.warn(`memory-files: ${clamped.join(', ')} provided an invalid value; falling back to the default`)
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
  const resolvedRoot = (config.root || '').trim()
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
  ctx.effect(() => ctx.memory.registerProvider(provider), 'memory-files.provider')
}

