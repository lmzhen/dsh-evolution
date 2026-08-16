/**
 * Local layered memory provider for `ctx.memory`.
 * @module @deepseek-ai/dsh-memory-files
 */

import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { MemoryStore, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution/src/memory-store.ts'
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
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('files'),
  memoryCharLimit: z.number().default(2200),
  userCharLimit: z.number().default(1375),
  addDatePrefix: z.boolean().default(false),
  root: z.string().default(''),
})

export function apply(ctx: Context, rawConfig: Config): void {
  const config = rawConfig as Required<Config>
  // The IO provider is resolved lazily so `memory-files` does not depend on
  // row order: the first write happens only after the preset has fully mounted.
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
  const store = new MemoryStore({
    memoryCharLimit: config.memoryCharLimit,
    userCharLimit: config.userCharLimit,
    addDatePrefix: config.addDatePrefix,
    ...config.root ? { root: config.root } : {},
    io,
  })
  const provider: MemoryProvider = {
    name: config.providerName,
    read: (target, _signal) => store.read(target),
    applyBatch: async (target: MemoryTarget, operations: MemoryOperation[]) => {
      const normalized = operations.map(op => ({ action: op.action, facts: op.facts ?? op.content, old_text: op.old_text }))
      return store.applyBatch(target, normalized)
    },
    snapshot: async (): Promise<MemorySnapshot> => {
      const [memory, user] = await Promise.all([store.read('memory'), store.read('user')])
      const text = JSON.stringify([memory, user])
      return { version: 1, sha256: createHash('sha256').update(text).digest('hex'), memory, user }
    },
    renderContext: () => store.renderContext(),
  }
  ctx.effect(() => ctx.memory.registerProvider(provider), 'memory-files.provider')
}

