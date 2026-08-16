/**
 * JSON-file evolution state provider over the IO seam.
 *
 * This is the portable provider: `ctx.evolutionIo` may be node:fs today and a
 * network/shared medium tomorrow without any state-format changes.
 * @module @deepseek-ai/dsh-evolution-state-json
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import type { CuratorStateRecord, EvolutionStateStorage, PendingRecord, PendingResolution, PendingStatus, ReviewStateRecord } from '@deepseek-ai/dsh-evolution-state-storage'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'evolution-state-json'
export const inject = ['evolutionStateStorage', 'evolutionIo']

export interface Config {
  root?: string
}

export const Config: z<Config> = z.object({
  root: z.string().default(''),
})

function defaultRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'evolution')
}

export function apply(ctx: Context, rawConfig: Config): void {
  const root = rawConfig.root || defaultRoot()
  const io = () => ctx.evolutionIo.provider()
  const pathOf = (file: string) => join(root, file)

  async function readJson<T>(file: string): Promise<T | null> {
    const raw = await io().readText(pathOf(file))
    if (raw === null) return null
    try { return JSON.parse(raw) as T } catch { return null }
  }

  async function writeJson(file: string, value: unknown): Promise<void> {
    await io().writeText(pathOf(file), JSON.stringify(value, null, 2))
  }

  // All JSON-file state mutations share one queue: each read-modify-write is
  // a single task, so concurrent review/curator/approval writers can never
  // overwrite each other's newest record. The IO provider itself already
  // writes atomically; this closes the lost-update window above it.
  let chain: Promise<unknown> = Promise.resolve()
  function mutate<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task)
    chain = run.then(() => undefined, () => undefined)
    return run
  }

  // `pending.json` is the pre-split approval store name. Reads MERGE both
  // files and the new `pending-state.json` wins on id conflicts, so creating
  // a new pending record can never hide legacy records still awaiting
  // approval. Mutations write back to `pending-state.json`; a resolved or
  // deleted record therefore overrides the legacy copy on the next read.
  async function loadPendingMap(): Promise<Record<string, PendingRecord>> {
    const [current, legacy] = await Promise.all([
      readJson<Record<string, PendingRecord>>('pending-state.json'),
      readJson<Record<string, PendingRecord>>('pending.json'),
    ])
    return { ...legacy ?? {}, ...current ?? {} }
  }

  const provider: EvolutionStateStorage = {
    name: 'json',

    async loadReviewState(sessionId) {
      return await mutate(async () => {
        const map = await readJson<Record<string, ReviewStateRecord>>('review-state.json')
        return map?.[sessionId] ?? null
      })
    },

    async saveReviewState(sessionId, record) {
      await mutate(async () => {
        const map = await readJson<Record<string, ReviewStateRecord>>('review-state.json') ?? {}
        map[sessionId] = record
        await writeJson('review-state.json', map)
      })
    },

    async loadCuratorState() {
      return await mutate(async () => {
        const map = await readJson<Record<string, CuratorStateRecord>>('curator-state.json')
        return map?.primary ?? null
      })
    },

    async saveCuratorState(record) {
      await mutate(async () => {
        const map = await readJson<Record<string, CuratorStateRecord>>('curator-state.json') ?? {}
        map.primary = record
        await writeJson('curator-state.json', map)
      })
    },

    async listPending(status: PendingStatus = 'pending') {
      return await mutate(async () => {
        const map = await loadPendingMap()
        return Object.values(map).filter(record => record.status === status)
      })
    },

    async savePending(record) {
      await mutate(async () => {
        const map = await loadPendingMap()
        map[record.id] = record
        await writeJson('pending-state.json', map)
      })
    },

    async deletePending(id) {
      await mutate(async () => {
        const map = await loadPendingMap()
        Reflect.deleteProperty(map, id)
        await writeJson('pending-state.json', map)
      })
    },

    async tryResolvePending(id, status): Promise<PendingResolution> {
      return await mutate(async () => {
        const map = await loadPendingMap()
        const record = map[id] ?? null
        if (record === null || record.status !== 'pending') return { record, applied: false }
        record.status = status
        record.resolvedAt = new Date().toISOString()
        await writeJson('pending-state.json', map)
        return { record, applied: true }
      })
    },
  }

  ctx.effect(() => ctx.evolutionStateStorage.registerProvider(provider), 'evolution-state-json.provider')
}
