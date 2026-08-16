/**
 * storage-domain provider for evolution state.
 *
 * When this provider is mounted, review/curator/pending records live in the
 * DSH storage-domain data form: schema-validated, change-emitting, durable KV
 * with whatever backend the domain facility routes (`json`, `sqlite`, remote
 * RPC, …). The provider is one of several implementations of the same seam.
 * @module @deepseek-ai/dsh-evolution-state-domain
 */

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { CuratorStateRecord, EvolutionStateStorage, PendingRecord, PendingResolution, PendingStatus, ReviewStateRecord } from '@deepseek-ai/dsh-evolution-state-storage'

export const name = 'evolution-state-domain'
export const inject = ['evolutionStateStorage', 'storageDomain']

export const reviewStateSchema = z.object({
  turnsSinceMemory: z.number().int().nonnegative(),
  turnsSinceSkill: z.number().int().nonnegative(),
  lastTurn: z.number().int().nonnegative(),
})

export const curatorStateSchema = z.object({
  lastRunAt: z.number().nonnegative(),
  runCount: z.number().int().nonnegative(),
  lastSummary: z.string(),
  paused: z.boolean(),
})

export const pendingSchema = z.object({
  id: z.string(),
  kind: z.union([z.literal('memory'), z.literal('skill'), z.literal('skill_batch'), z.literal('capability')]),
  summary: z.string(),
  args: z.unknown(),
  createdAt: z.string(),
  status: z.union([z.literal('pending'), z.literal('approved'), z.literal('rejected')]),
  resolvedAt: z.string().optional(),
  claimedBy: z.string().optional(),
  claimedAt: z.string().optional(),
})

export const EVOLUTION_DOMAIN = defineDomain({
  name: 'evolution',
  version: 1,
  tables: {
    review_state: domainTable<string, ReviewStateRecord>(reviewStateSchema),
    curator_state: domainTable<string, CuratorStateRecord>(curatorStateSchema),
    pending: domainTable<string, PendingRecord>(pendingSchema),
  },
})

interface StorageDomainLike {
  open(spec: typeof EVOLUTION_DOMAIN): Promise<Domain<typeof EVOLUTION_DOMAIN>>
}

export function apply(ctx: Context): void {
  let domain: Domain<typeof EVOLUTION_DOMAIN> | null = null
  let opening: Promise<Domain<typeof EVOLUTION_DOMAIN>> | null = null

  async function ensure(): Promise<Domain<typeof EVOLUTION_DOMAIN>> {
    if (domain) return domain
    const facility = ctx.get('storageDomain') as StorageDomainLike | undefined
    if (!facility) throw new Error('evolution-state-domain requires @deepseek-ai/dsh-storage-domain')
    opening ??= facility.open(EVOLUTION_DOMAIN)
    domain = await opening
    return domain
  }

  const provider: EvolutionStateStorage = {
    name: 'domain',

    async loadReviewState(sessionId) {
      return (await ensure()).table('review_state').get(sessionId) ?? null
    },

    async saveReviewState(sessionId, record) {
      await (await ensure()).table('review_state').put(sessionId, record)
    },

    async loadCuratorState() {
      return (await ensure()).table('curator_state').get('primary') ?? null
    },

    async saveCuratorState(record) {
      await (await ensure()).table('curator_state').put('primary', record)
    },

    async listPending(status: PendingStatus = 'pending') {
      const table = (await ensure()).table('pending')
      return [...table.entries()].map(([, value]) => value).filter(record => record.status === status)
    },

    async savePending(record) {
      await (await ensure()).table('pending').put(record.id, record)
    },

    async deletePending(id) {
      await (await ensure()).table('pending').delete(id)
    },

    async claimPending(id, claimId) {
      const table = (await ensure()).table('pending')
      try {
        const slot = { record: null as PendingRecord | null }
        const now = Date.now()
        await table.update(id, (current) => {
          if (current.status !== 'pending') return current
          const claimedAt = typeof current.claimedAt === 'string' ? Date.parse(current.claimedAt) : 0
          if (current.claimedBy !== undefined && Number.isFinite(claimedAt) && now - claimedAt < 10 * 60_000) return current
          slot.record = { ...current, claimedBy: claimId, claimedAt: new Date(now).toISOString() }
          return slot.record
        })
        return slot.record
      } catch {
        return null
      }
    },

    async releasePendingClaim(id, claimId) {
      const table = (await ensure()).table('pending')
      await table.update(id, (current) => {
        if (current.status === 'pending' && current.claimedBy === claimId) {
          const released = { ...current }
          delete released.claimedBy
          delete released.claimedAt
          return released
        }
        return current
      })
    },

    async tryResolvePending(id, status): Promise<PendingResolution> {
      const table = (await ensure()).table('pending')
      try {
        const resolved = { record: null as PendingRecord | null }
        const record = await table.update(id, (current) => {
          if (current.status !== 'pending') return current
          resolved.record = { ...current, status, resolvedAt: new Date().toISOString() }
          return resolved.record
        })
        if (resolved.record === null) return { record: record.status === status ? record : null, applied: false }
        return { record: resolved.record, applied: true }
      } catch {
        return { record: null, applied: false }
      }
    },
  }

  ctx.effect(() => {
    const dispose = ctx.evolutionStateStorage.registerProvider(provider)
    return async () => {
      dispose()
      if (domain) await domain.close()
      domain = null
      opening = null
    }
  }, 'evolution-state-domain.provider')
}
