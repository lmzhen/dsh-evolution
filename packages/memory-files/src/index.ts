/**
 * Local layered memory provider for `ctx.memory`.
 * @module @deepseek-ai/dsh-memory-files
 */

import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_CONSOLIDATION_FAILURES, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_USER_CHAR_LIMIT, evolutionIoAdapter, makeSerialQueue, MemoryStore } from '@deepseek-ai/dsh-evolution-core'
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
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('files'),
  memoryCharLimit: z.number().default(DEFAULT_MEMORY_CHAR_LIMIT),
  userCharLimit: z.number().default(DEFAULT_USER_CHAR_LIMIT),
  addDatePrefix: z.boolean().default(false),
  root: z.string().default(''),
  maxConsolidationFailures: z.number().default(DEFAULT_CONSOLIDATION_FAILURES),
})

export function apply(ctx: Context, rawConfig: Config): void {
  const config = rawConfig as Required<Config>
  // The IO provider is resolved lazily so `memory-files` does not depend on
  // row order: the first write happens only after the preset has fully mounted.
  const io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
  // In-process write serialization: applyBatch is read-modify-write, so two
  // concurrent callers (multi-session host) can otherwise compute on the same
  // old entries and the last rename wins, silently dropping the other's ops.
  // 0.3.17 (S2.8, T-1): the queue factory is shared with state-json now.
  const serializedWrite = makeSerialQueue()
  const store = new MemoryStore({
    memoryCharLimit: config.memoryCharLimit,
    userCharLimit: config.userCharLimit,
    addDatePrefix: config.addDatePrefix,
    maxConsolidationFailures: config.maxConsolidationFailures,
    ...config.root ? { root: config.root } : {},
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
      // Promise.all reads used to produce a mixed-generation snapshot. The
      // cross-process window is documented as accepted (single-process chain
      // is this family's second layer).
      const memory = await store.read('memory')
      const user = await store.read('user')
      const text = JSON.stringify([memory, user])
      return { version: 1, sha256: createHash('sha256').update(text).digest('hex'), memory, user }
    },
    renderContext: () => store.renderContext(),
  }
  ctx.effect(() => ctx.memory.registerProvider(provider), 'memory-files.provider')
}

