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
import { transactIo } from '@deepseek-ai/dsh-evolution-core'
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

  /**
   * Cross-process JSON-file RMW (v3-audit M-8): every read-modify-write state
   * mutation runs inside the IO backend's transact lock (via transactIo) so a
   * second process sharing DSH_HOME cannot interleave its claim/resolve.
   * `task` returns the next value (null = delete); the legacy `pending.json`
   * merge stays inside the task via `readJson` where relevant.
   */
  async function jsonTransact<T>(file: string, task: (current: T | null) => T | null | Promise<T | null>): Promise<void> {
    await transactIo(ctx.evolutionIo.provider(), pathOf(file), async (current) => {
      let parsed: T | null = null
      if (current !== null) {
        try { parsed = JSON.parse(current) as T } catch { parsed = null }
      }
      const next = await task(parsed)
      return next === null ? null : JSON.stringify(next, null, 2)
    })
  }

  // All JSON-file state mutations share one queue: each read-modify-write is
  // a single task, so concurrent review/curator/approval writers can never
  // overwrite each other's newest record in THIS process. The transact lock
  // (jsonTransact) covers OTHER processes; this chain is the second layer.
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
    return { ...(legacy ?? {}), ...(current ?? {}) }
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
        await jsonTransact<Record<string, ReviewStateRecord>>('review-state.json', current => ({ ...(current ?? {}), [sessionId]: record }))
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
        await jsonTransact<Record<string, CuratorStateRecord>>('curator-state.json', current => ({ ...(current ?? {}), primary: record }))
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
        await jsonTransact<Record<string, PendingRecord>>('pending-state.json', async (current) => {
          const legacy = await readJson<Record<string, PendingRecord>>('pending.json')
          const map = { ...(legacy ?? {}), ...(current ?? {}), [record.id]: record }
          return map
        })
      })
    },

    async claimPending(id, claimId) {
      return await mutate(async () => {
        const slot = { claimed: null as PendingRecord | null }
        await jsonTransact<Record<string, PendingRecord>>('pending-state.json', async (current) => {
          const legacy = await readJson<Record<string, PendingRecord>>('pending.json')
          const map = { ...(legacy ?? {}), ...(current ?? {}) }
          const record = map[id] ?? null
          if (record === null || record.status !== 'pending') return map
          const now = Date.now()
          const claimedAt = typeof record.claimedAt === 'string' ? Date.parse(record.claimedAt) : 0
          if (record.claimedBy !== undefined && Number.isFinite(claimedAt) && now - claimedAt < 10 * 60_000) return map
          slot.claimed = { ...record, claimedBy: claimId, claimedAt: new Date(now).toISOString() }
          map[id] = slot.claimed
          return map
        })
        return slot.claimed ? { ...slot.claimed } : null
      })
    },

    async releasePendingClaim(id, claimId) {
      await mutate(async () => {
        await jsonTransact<Record<string, PendingRecord>>('pending-state.json', async (current) => {
          const legacy = await readJson<Record<string, PendingRecord>>('pending.json')
          const map = { ...(legacy ?? {}), ...(current ?? {}) }
          const record = map[id]
          if (record && record.status === 'pending' && record.claimedBy === claimId) {
            delete record.claimedBy
            delete record.claimedAt
          }
          return map
        })
      })
    },

    async tryResolvePending(id, status): Promise<PendingResolution> {
      return await mutate(async () => {
        let result: PendingResolution = { record: null, applied: false }
        await jsonTransact<Record<string, PendingRecord>>('pending-state.json', async (current) => {
          const legacy = await readJson<Record<string, PendingRecord>>('pending.json')
          const map = { ...(legacy ?? {}), ...(current ?? {}) }
          const record = map[id] ?? null
          if (record === null || record.status !== 'pending') {
            result = { record, applied: false }
            return map
          }
          const resolved = { ...record, status, resolvedAt: new Date().toISOString() }
          map[id] = resolved
          result = { record: resolved, applied: true }
          return map
        })
        return result
      })
    },
  }

  ctx.effect(() => ctx.evolutionStateStorage.registerProvider(provider), 'evolution-state-json.provider')
}
