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
import { defineDomain, domainTable, DomainError } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import {
  canClaimPending,
  canResolvePending,
  releasedStatus,
  CURATOR_STATE_KEY,
  CURATOR_STATE_TABLE,
  PENDING_RESOLVED_CAP as SEAM_PENDING_RESOLVED_CAP,
  PENDING_TABLE,
  PROVIDER_DOMAIN,
  REVIEW_STATE_TABLE,
  type CuratorStateRecord,
  type EvolutionStateStorage,
  type PendingRecord,
  type PendingResolution,
  type PendingStatus,
  type ReviewStateRecord,
} from '@deepseek-ai/dsh-evolution-state-storage'

export const name = 'evolution-state-domain'
export const inject = ['evolutionStateStorage', 'storageDomain']

/**
 * Review-state record schema of the storage-domain table.
 * @internal Referenced only by this package's own tests and EVOLUTION_DOMAIN
 * below — not public API surface (audit v10 S-03); the record contract lives
 * in `@deepseek-ai/dsh-evolution-state-storage` types.
 */
export const reviewStateSchema = z.object({
  turnsSinceMemory: z.number().int().nonnegative(),
  turnsSinceSkill: z.number().int().nonnegative(),
  lastTurn: z.number().int().nonnegative(),
})

/**
 * Curator-state record schema of the storage-domain table.
 * @internal Referenced only by this package's own tests and EVOLUTION_DOMAIN
 * below — not public API surface (audit v10 S-03).
 */
export const curatorStateSchema = z.object({
  /** Optional record-shape version; legacy records without it stay compatible. */
  schemaVersion: z.number().int().nonnegative().optional(),
  lastRunAt: z.number().nonnegative(),
  runCount: z.number().int().nonnegative(),
  lastSummary: z.string(),
  paused: z.boolean(),
})

/**
 * Pending record schema of the storage-domain table.
 * @internal Referenced only by this package's own tests and EVOLUTION_DOMAIN
 * below — not public API surface (audit v10 S-03).
 */
export const pendingSchema = z.object({
  id: z.string(),
  // 0.3.17 (S3.5, D-4): 'skill_batch' is gone — nothing ever created one, and
  // the TYPE no longer carries it (legacy-looking values parse as unknown).
  kind: z.union([z.literal('memory'), z.literal('skill'), z.literal('capability')]),
  summary: z.string(),
  args: z.unknown(),
  createdAt: z.string(),
  status: z.union([z.literal('pending'), z.literal('executing'), z.literal('approved'), z.literal('rejected')]),
  resolvedAt: z.string().optional(),
  claimedBy: z.string().optional(),
  claimedAt: z.string().optional(),
  // 0.3.22 (F-214): origin/sessionId were missing, so zod's default strip
  // dropped them on the domain read path — a resolved audit record reopened
  // from the medium lost its attribution. Added so the round-trip keeps them.
  origin: z.string().optional(),
  sessionId: z.string().optional(),
})

/**
 * The evolution storage-domain spec: three schema-validated KV tables.
 * @internal Referenced only by this package's own tests and `open()` — not
 * public API surface (audit v10 S-03).
 */
export const EVOLUTION_DOMAIN = defineDomain({
  name: 'evolution',
  version: 1,
  tables: {
    [REVIEW_STATE_TABLE]: domainTable<string, ReviewStateRecord>(reviewStateSchema),
    [CURATOR_STATE_TABLE]: domainTable<string, CuratorStateRecord>(curatorStateSchema),
    [PENDING_TABLE]: domainTable<string, PendingRecord>(pendingSchema),
  },
})

interface StorageDomainLike {
  open(spec: typeof EVOLUTION_DOMAIN): Promise<Domain<typeof EVOLUTION_DOMAIN>>
}

/**
 * Bounded open() retry (rc.42 audit P1-4, package-private): a rejected open
 * used to poison the shared `opening` promise forever, so one transient
 * backend failure (lock, busy) took the provider down until process restart.
 * Transient failures now recover within the budget; deterministic failures
 * (corrupt domain version) surface after it, and the cleared promise lets a
 * later call start a fresh budget.
 */
const OPEN_MAX_ATTEMPTS = 3
const OPEN_RETRY_BASE_MS = 100

export function apply(ctx: Context): void {
  let domain: Domain<typeof EVOLUTION_DOMAIN> | null = null
  let opening: Promise<Domain<typeof EVOLUTION_DOMAIN>> | null = null

  async function ensure(): Promise<Domain<typeof EVOLUTION_DOMAIN>> {
    if (domain) return domain
    if (!opening) {
      opening = (async () => {
        const facility = ctx.get('storageDomain') as StorageDomainLike | undefined
        if (!facility) throw new Error('evolution-state-domain requires @deepseek-ai/dsh-storage-domain')
        let lastError: unknown
        for (let attempt = 1; attempt <= OPEN_MAX_ATTEMPTS; attempt += 1) {
          try {
            return await facility.open(EVOLUTION_DOMAIN)
          } catch (error) {
            lastError = error
            if (attempt < OPEN_MAX_ATTEMPTS) {
              await new Promise(resolve => setTimeout(resolve, OPEN_RETRY_BASE_MS * 2 ** (attempt - 1)))
            }
          }
        }
        throw lastError
      })()
      // Clear on rejection so the next provider call starts a fresh budget.
      void opening.catch(() => { opening = null })
    }
    domain = await opening
    return domain
  }

  const provider: EvolutionStateStorage = {
    name: PROVIDER_DOMAIN,

    async loadReviewState(sessionId) {
      return (await ensure()).table(REVIEW_STATE_TABLE).get(sessionId) ?? null
    },

    async saveReviewState(sessionId, record) {
      await (await ensure()).table(REVIEW_STATE_TABLE).put(sessionId, record)
    },

    async loadCuratorState() {
      return (await ensure()).table(CURATOR_STATE_TABLE).get(CURATOR_STATE_KEY) ?? null
    },

    async saveCuratorState(record) {
      await (await ensure()).table(CURATOR_STATE_TABLE).put(CURATOR_STATE_KEY, record)
    },

    async transactCuratorState(task) {
      const table = (await ensure()).table(CURATOR_STATE_TABLE)
      // Atomic read-modify-write on the domain write chain: `task` sees the
      // record current at its queue slot, so a setPaused racing the run-core
      // bookkeeping write never interleaves. task returns null to keep the
      // record unchanged (the domain update primitive cannot delete).
      try {
        await table.update(CURATOR_STATE_KEY, current => task(current) ?? current)
        return
      } catch (error) {
        if (!(error instanceof DomainError && error.code === 'missing-key')) throw error
      }
      // P2-4: fresh-install missing-key recovery now retries the
      // SAME atomic update ONCE before seeding. The old shape (update reject →
      // task(null) → bare put) computed the seed from a stale null basis: a
      // concurrent first-writer that created the key between our failed
      // update and our put was silently OVERWRITTEN (lost update), violating
      // the seam's "whole RMW inside one transact" contract. The optimistic
      // retry re-enters the domain write chain: if the concurrent writer has
      // created the key meanwhile, `task` runs on the FRESH basis and nothing
      // is lost. Only a SECOND missing-key proves the key still absent, so the
      // seed below is safe against the common race — the residual window
      // between that second missing-key and the put is a narrow lost-update
      // possibility (no conditional-put primitive on the domain seam), not a
      // "races no third party" guarantee.
      try {
        await table.update(CURATOR_STATE_KEY, current => task(current) ?? current)
        return
      } catch (error) {
        if (!(error instanceof DomainError && error.code === 'missing-key')) throw error
      }
      // Fresh install, still no record: seed by applying the task to null and
      // putting the result (delete when null).
      const next = task(null)
      if (next !== null) await table.put(CURATOR_STATE_KEY, next)
      else await table.delete(CURATOR_STATE_KEY)
    },

    async listPending(status: PendingStatus = 'pending') {
      const table = (await ensure()).table(PENDING_TABLE)
      return [...table.entries()].map(([, value]) => value).filter(record => record.status === status)
    },

    async savePending(record) {
      await (await ensure()).table(PENDING_TABLE).put(record.id, record)
    },

    async claimPending(id, claimId) {
      const table = (await ensure()).table(PENDING_TABLE)
      try {
        const slot = { record: null as PendingRecord | null }
        const now = Date.now()
        await table.update(id, (current) => {
          // 0.3.17 (S3.3, E-24): SAME transition table as the json provider
          // (state-storage helpers) — claim atomically moves to 'executing' so
          // a crash mid-approve can never double-execute the runner.
          if (!canClaimPending(current.status)) return current
          slot.record = { ...current, status: 'executing', claimedBy: claimId, claimedAt: new Date(now).toISOString() }
          return slot.record
        })
        // V6-33 (0.3.37): return a copy — the update callback's no-change
        // paths may hand back the internal record object; an in-place mutation
        // by the caller would silently poison the domain map (the json
        // provider returns copies).
        return slot.record === null ? null : { ...slot.record }
      } catch (error: unknown) {
        // Missing key is the benign "no such pending record" outcome; a
        // closed domain or backend failure must surface so approval reports
        // the real cause instead of "already being resolved" (v3-round self-check).
        if (error instanceof DomainError && error.code === 'missing-key') return null
        throw error
      }
    },

    async releasePendingClaim(id, claimId) {
      const table = (await ensure()).table(PENDING_TABLE)
      try {
        await table.update(id, (current) => {
          if (current.status !== 'pending' && current.status !== 'executing') return current
          if (current.claimedBy !== claimId) return current
          const released = { ...current, status: releasedStatus(current.status) }
          delete released.claimedBy
          delete released.claimedAt
          return released
        })
      } catch (error: unknown) {
        // 0.3.22 (F-332): release is a no-op on a record that never existed,
        // matching the json provider (and the claimPending/tryResolvePending
        // benign-vs-malign split); a closed/backend error still surfaces.
        if (error instanceof DomainError && error.code === 'missing-key') return
        throw error
      }
    },

    async tryResolvePending(id, status, expectedClaimId): Promise<PendingResolution> {
      const table = (await ensure()).table(PENDING_TABLE)
      try {
        const resolved = { record: null as PendingRecord | null }
        const record = await table.update(id, (current) => {
          if (!canResolvePending(current.status)) return current
          // P2-2 (v14): claim-scoped resolve — refuse once the record is no
          // longer ours (same rule as the json provider).
          if (expectedClaimId !== undefined && current.claimedBy !== expectedClaimId) return current
          resolved.record = { ...current, status, resolvedAt: new Date().toISOString() }
          return resolved.record
        })
        // P2-4 (v15): the live pending table is bounded by the seam contract
        // (`PENDING_RESOLVED_CAP`, the same number the json provider enforces)
        // — the domain table used to grow without bound because json's
        // cap/archive had no domain counterpart. json's audit ARCHIVE sidecar
        // stays json-specific (no sidecar facility on the domain seam).
        // P2 (v16): three corrections to the first cut — (1) the budget counts
        // RESOLVED records only (pending/executing no longer shrink it), which
        // is what the seam JSDoc and json's `enforceResolvedCap` already say;
        // (2) a missing/unparseable resolvedAt sorts LAST (json parity — an
        // unknown time must not make a record the oldest), via Date.parse
        // instead of localeCompare so both providers agree on ordering;
        // (3) eviction is best-effort: the resolve has already committed, so a
        // delete failure warns instead of surfacing as a failed approve.
        if (resolved.record !== null) {
          const resolvedEntries = [...table.entries()]
            .map(([key, record]) => ({ key, record: record as PendingRecord }))
            .filter(entry => entry.record.status === 'approved' || entry.record.status === 'rejected')
          const resolvedAtMs = (record: PendingRecord): number => {
            const parsed = Date.parse(record.resolvedAt ?? '')
            return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
          }
          resolvedEntries.sort((a, b) => resolvedAtMs(a.record) - resolvedAtMs(b.record))
          const evicted = resolvedEntries.slice(0, Math.max(0, resolvedEntries.length - SEAM_PENDING_RESOLVED_CAP))
          for (const entry of evicted) {
            await table.delete(entry.key).catch((error: unknown) => {
              ctx.logger.warn(`evolution-state-domain: pending-cap eviction for "${entry.key}" failed (will retry on the next resolve): ${error instanceof Error ? error.message : String(error)}`)
            })
          }
        }
        const rawRecord: unknown = record
        if (resolved.record === null) return { record: rawRecord === null ? null : { ...(rawRecord as PendingRecord) }, applied: false }
        return { record: { ...resolved.record }, applied: true }
      } catch (error: unknown) {
        // v3-round self-check: only missing-key is benign; closed/backend errors propagate.
        if (error instanceof DomainError && error.code === 'missing-key') return { record: null, applied: false }
        throw error
      }
    },
  }

  ctx.effect(() => {
    const dispose = ctx.evolutionStateStorage.registerProvider(provider)
    return async () => {
      dispose()
      // 0.3.17 (E-17): an in-flight open (still inside its retry budget) used
      // to resolve AFTER disposal and left the freshly opened domain unclosed —
      // a fast enable/disable cycle leaked a handle. Wait for it, then close.
      if (opening) await opening.catch(() => null)
      if (domain) await domain.close()
      domain = null
      opening = null
    }
  }, 'evolution-state-domain.provider')
}
