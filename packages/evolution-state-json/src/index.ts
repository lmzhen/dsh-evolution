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
import { makeSerialQueue, transactIo } from '@deepseek-ai/dsh-evolution-core'
import { canClaimPending, canResolvePending, CLAIM_EXPIRY_MS, releasedStatus, type CuratorStateRecord, type EvolutionStateStorage, type PendingRecord, type PendingResolution, type PendingStatus, type ReviewStateRecord } from '@deepseek-ai/dsh-evolution-state-storage'
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

  /** 0.3.17 (E-9): a malformed state file used to parse to `null` and was then
   * OVERWRITTEN by the next save — every other session's review state / the
   * whole pending table vanished silently. Fail loud instead: preserve the
   * original bytes beside it and throw, so the operator can rescue and the
   * corruption is never accepted as "empty". */
  async function quarantine(file: string, raw: string, reason: string): Promise<never> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = `${pathOf(file)}.corrupt-${stamp}-${Math.random().toString(36).slice(2, 6)}`
    await io().writeText(dest, raw).catch(() => {})
    throw new Error(`evolution state file "${file}" is not valid JSON (${reason}); original preserved at ${dest} — inspect and fix it, then retry.`)
  }

  async function readJson<T>(file: string): Promise<T | null> {
    const raw = await io().readText(pathOf(file))
    if (raw === null) return null
    try { return JSON.parse(raw) as T } catch (error) {
      return await quarantine(file, raw, error instanceof Error ? error.message : String(error))
    }
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
        try { parsed = JSON.parse(current) as T } catch (error) {
          return await quarantine(file, current, error instanceof Error ? error.message : String(error))
        }
      }
      const next = await task(parsed)
      return next === null ? null : JSON.stringify(next, null, 2)
    })
  }

  // All JSON-file state mutations share one queue: each read-modify-write is
  // a single task, so concurrent review/curator/approval writers can never
  // overwrite each other's newest record in THIS process. The transact lock
  // (jsonTransact) covers OTHER processes; this chain is the second layer.
  // 0.3.17 (S2.8, T-1): the queue factory is shared with memory-files now.
  const mutate = makeSerialQueue()

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

    async transactCuratorState(task) {
      await mutate(async () => {
        await jsonTransact<Record<string, CuratorStateRecord>>('curator-state.json', (current) => {
          const next = task(current?.primary ?? null)
          if (next === null) {
            if (current !== null) delete current.primary
            return current ?? {}
          }
          return { ...(current ?? {}), primary: next }
        })
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
          if (record === null || !canClaimPending(record.status)) return map
          const now = Date.now()
          const claimedAt = typeof record.claimedAt === 'string' ? Date.parse(record.claimedAt) : 0
          if (record.claimedBy !== undefined && Number.isFinite(claimedAt) && now - claimedAt < CLAIM_EXPIRY_MS) return map
          // 0.3.17 (S3.3, E-24): claiming moves the record to 'executing'
          // atomically — a crash after the runner executed but before the
          // resolve can no longer be re-claimed into a SECOND execution (the
          // resolve only accepts pending/executing, and a fresh claim requires
          // 'pending').
          slot.claimed = { ...record, status: 'executing', claimedBy: claimId, claimedAt: new Date(now).toISOString() }
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
          // 0.3.17 (S3.3): releasing a CLAIMED-EXECUTING record rolls it back to
          // pending (a runner FAILURE is retryable); a crash leaves it
          // executing + claimed until expiry, then operator-resolvable.
          if (!record || record.claimedBy !== claimId) return map
          record.status = releasedStatus(record.status)
          delete record.claimedBy
          delete record.claimedAt
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
          // 0.3.17 (S3.3): 'executing' (claimed but not yet resolved) is a
          // legal resolve source — a crash mid-approve leaves it there for the
          // operator; a DUPLICATE execution is what this blocks.
          if (record === null || !canResolvePending(record.status)) {
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
