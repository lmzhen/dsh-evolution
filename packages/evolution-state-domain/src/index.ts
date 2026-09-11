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
  assertCloneable,
  canClaimPending,
  canResolvePending,
  cloneRecord,
  recordIssue,
  releasedStatus,
  CURATOR_STATE_KEY,
  CURATOR_STATE_TABLE,
  PENDING_RESOLVED_CAP as SEAM_PENDING_RESOLVED_CAP,
  PENDING_TABLE,
  PROVIDER_DOMAIN,
  REVIEW_STATE_SESSION_CAP,
  REVIEW_STATE_TABLE,
  selectPendingOverflow,
  selectSessionOverflow,
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
}).loose()

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
}).loose()

/**
 * Pending record schema of the storage-domain table.
 * @internal Referenced only by this package's own tests and EVOLUTION_DOMAIN
 * below — not public API surface (audit v10 S-03).
 */
export const pendingSchema = z.object({
  id: z.string(),
  // 0.3.17 (S3.5, D-4): 'skill_batch' is gone — nothing ever created one, and
  // the TYPE no longer carries it (legacy-looking values parse as unknown).
  // 0.3.66: 'capability' stays for rows written before its producer was removed
  // (see PendingKind) — this schema is what `open()` validates every stored
  // record against, so one such row must not fail the whole domain at mount.
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
}).loose()

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
      // C-2 (v18): return a DEEP copy — the caller (advanceReview) mutates the
      // record before save, and `args`-carrying records share nested objects
      // with the domain map; a rejected save must not leave the domain's
      // in-memory record ahead of the medium (the json provider serializes, so
      // it is deep by construction).
      const record = (await ensure()).table(REVIEW_STATE_TABLE).get(sessionId)
      if (record === undefined) return null
      // V24-08 (v24): strip the provider-internal eviction stamp on read so
      // the consumer-facing record shape is unchanged (json parity).
      const { updatedAt: _stamp, ...rest } = record as ReviewStateRecord & { updatedAt?: number }
      return structuredClone(rest)
    },

    async saveReviewState(sessionId, record) {
      // P2-1 (v18): upstream storage-domain validates stored records only on
      // open(); a blind put here would persist a bad record and make the WHOLE
      // evolution domain fail to open with `invalid-record` on the next mount.
      // P2-12/15 (v19): the gate is the SEAM's shared contract (same one the
      // json provider applies), and the stored value is a deep copy so the
      // caller cannot mutate the authoritative in-memory record afterwards.
      const issue = recordIssue(REVIEW_STATE_TABLE, record) ?? assertCloneable(record)
      if (issue !== null) throw new Error(`evolution-state-domain: refusing to persist an invalid review-state record: ${issue}`)
      const parsed = reviewStateSchema.safeParse(record)
      if (!parsed.success) {
        throw new Error(`evolution-state-domain: refusing to persist an invalid review-state record: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`)
      }
      const table = (await ensure()).table(REVIEW_STATE_TABLE)
      // V24-08 (v24): store WITH the eviction stamp — the `.loose()` schema
      // passes the extra field through, and loadReviewState strips it on read
      // (json parity), so the consumer-facing record shape is unchanged. The
      // gate above runs on the CONSUMER record, not the stamp.
      const stamped = { ...cloneRecord(parsed.data), updatedAt: Date.now() } as ReviewStateRecord & { updatedAt: number }
      await table.put(sessionId, stamped)
      // V24-08 (v24): session cap — the review pipeline saves on every
      // turn/end and nothing pruned rows, so the table grew with the deploy's
      // whole session history. Same cap discipline as the pending table
      // (SEAM constant, enforced by json too). Eviction is best-effort (the
      // save has already committed; a delete failure warns and retries on the
      // next save). A row without `updatedAt` (pre-0.3.67 writer) sorts as
      // oldest and evicts first — unlike pending's resolvedAt convention —
      // because an active session re-stamps its row on its very next save, so
      // the "unknown" state is always stale by construction.
      const entries = [...table.entries()]
        .map(([key, row]) => ({ key, updatedAt: (row as { updatedAt?: number }).updatedAt ?? 0 }))
        .filter(entry => entry.key !== sessionId)
      // V27 G2.2: which rows to evict is the SEAM's pure rule (shared with the
      // json provider) — this provider supplies keys and stamps only.
      const victims = new Set(selectSessionOverflow(entries, {
        keyOf: entry => entry.key,
        stampOf: entry => entry.updatedAt,
      }, REVIEW_STATE_SESSION_CAP))
      for (const entry of entries.filter(candidate => victims.has(candidate.key))) {
        const current = table.get(entry.key)
        // C-5 pattern: re-read between the snapshot and the delete — a
        // concurrent save may have refreshed (or removed) the row the
        // snapshot measured; only evict the exact staleness we saw.
        if (current === undefined || ((current as { updatedAt?: number }).updatedAt ?? 0) !== entry.updatedAt) continue
        await table.delete(entry.key).catch((error: unknown) => {
          ctx.logger.warn(`evolution-state-domain: review-state session-cap eviction for "${entry.key}" failed (will retry on the next save): ${error instanceof Error ? error.message : String(error)}`)
        })
      }
    },

    async loadCuratorState() {
      const record = (await ensure()).table(CURATOR_STATE_TABLE).get(CURATOR_STATE_KEY)
      return record === undefined ? null : structuredClone(record)
    },

    async saveCuratorState(record) {
      // P2-1 (v18): same write-boundary validation as saveReviewState — the
      // domain `put` itself does not parse, only `open()` does.
      // P2-12/15 (v19): shared seam gate + deep copy.
      const issue = recordIssue(CURATOR_STATE_TABLE, record) ?? assertCloneable(record)
      if (issue !== null) throw new Error(`evolution-state-domain: refusing to persist an invalid curator-state record: ${issue}`)
      const parsed = curatorStateSchema.safeParse(record)
      if (!parsed.success) {
        throw new Error(`evolution-state-domain: refusing to persist an invalid curator-state record: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`)
      }
      await (await ensure()).table(CURATOR_STATE_TABLE).put(CURATOR_STATE_KEY, cloneRecord(parsed.data))
    },

    async transactCuratorState(task) {
      const table = (await ensure()).table(CURATOR_STATE_TABLE)
      // P2-12 (v19): the task's output is validated with the SAME seam gate as
      // the direct save paths — this fourth write path used to bypass every
      // check, so a consumer returning a malformed record persisted it and the
      // next `open()` failed the whole domain with `invalid-record`.
      const guarded = (current: CuratorStateRecord | null): CuratorStateRecord | null => {
        // V27 S4: hand the task a COPY. The storage-domain update callback
        // receives the live stored object (upstream requires it not be mutated
        // in place), and a task that mutated it and then failed the validation
        // below would leave the mutation in the provider's in-memory store
        // while the write was refused. json already hands a freshly parsed
        // object, so this also aligns the two providers (transactCuratorState
        // contract in evolution-state-storage).
        const next = task(current === null ? null : cloneRecord(current))
        if (next === null) return null
        const issue = recordIssue(CURATOR_STATE_TABLE, next) ?? assertCloneable(next)
        if (issue !== null) throw new Error(`evolution-state-domain: refusing to persist an invalid curator-state record: ${issue}`)
        return cloneRecord(next)
      }
      // Atomic read-modify-write on the domain write chain: `task` sees the
      // record current at its queue slot, so a setPaused racing the run-core
      // bookkeeping write never interleaves. task returns null to keep the
      // record unchanged (the domain update primitive cannot delete).
      try {
        await table.update(CURATOR_STATE_KEY, current => guarded(current) ?? current)
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
        await table.update(CURATOR_STATE_KEY, current => guarded(current) ?? current)
        return
      } catch (error) {
        if (!(error instanceof DomainError && error.code === 'missing-key')) throw error
      }
      // Fresh install, still no record: seed by applying the task to null and
      // putting the result (delete when null) — same seam gate as above.
      const next = guarded(null)
      if (next !== null) await table.put(CURATOR_STATE_KEY, next)
      else await table.delete(CURATOR_STATE_KEY)
    },

    async listPending(status: PendingStatus = 'pending') {
      const table = (await ensure()).table(PENDING_TABLE)
      // C-2 (v18): deep copies, so a consumer cannot mutate the domain map
      // (including the nested `args` object of a pending record).
      // P2-15 (v19): filter BEFORE cloning — the v18 shape cloned every record
      // first, so one non-cloneable record (a function in `args`, which the
      // write gate now refuses) would have thrown for every status.
      return [...table.entries()]
        .filter(([, value]) => value.status === status)
        .map(([, value]) => structuredClone(value))
    },

    async savePending(record) {
      // C-3 (v18) + P2-12/15 (v19): the seam's shared gate covers the required
      // `args` key, every field type and cloneability — the same checks the
      // json provider applies, so neither medium can persist what the other
      // would refuse. The stored value is a deep copy (P2-14: `args` used to be
      // shared by reference with the caller).
      const issue = recordIssue(PENDING_TABLE, record) ?? assertCloneable(record)
      if (issue !== null) throw new Error(`evolution-state-domain: refusing to persist an invalid pending record: ${issue}`)
      const parsed = pendingSchema.safeParse({ ...record, args: record.args })
      if (!parsed.success) {
        throw new Error(`evolution-state-domain: refusing to persist an invalid pending record: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`)
      }
      await (await ensure()).table(PENDING_TABLE).put(record.id, cloneRecord(parsed.data))
    },

    async claimPending(id, claimId) {
      // v20 (A-4) provider contract, applies to EVERY guarded RMW below
      // (claim/resolve/release/transact): a REJECTED transition returns
      // `current` unchanged, and the upstream domain `update` primitive
      // persists unconditionally — so a rejection still costs one no-op
      // backend write plus one `domain/changed` event. This is accepted
      // seam behavior, NOT a bug: the seam has no conditional-write
      // primitive, short-circuiting here would break the atomicity the
      // update callback provides, and the json provider's byte-identical
      // short-circuit (core io.ts `next !== current`) is the documented
      // asymmetry between the two media. Consequences: duplicate approve/
      // resolve clicks and "null = keep" transacts churn one write each;
      // `domain/changed` listeners must tolerate no-op puts.
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
        return slot.record === null ? null : structuredClone(slot.record)
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
        // P2-13 (v19) residual, stated precisely: upstream `Table.delete`
        // decides existence at its own queue slot, so a `savePending` enqueued
        // AFTER the synchronous `table.get` re-check below but BEFORE the
        // delete job would be deleted. Closing that window needs a conditional
        // delete primitive the seam does not have (the audit's C-5 direction);
        // the re-check narrows it and in-tree mounts use randomUUID ids, so it
        // requires a third-party/hand-written id reused across the window.
        if (resolved.record !== null) {
          // V27 G2.2: eligibility + ordering come from the SEAM's pure rule
          // (shared with the json provider); this provider keeps only its
          // medium-specific part — the C-5 re-read guard before each delete.
          const evictedRecords = new Set(selectPendingOverflow(
            [...table.entries()].map(([, record]) => record),
            SEAM_PENDING_RESOLVED_CAP,
          ))
          const evicted = [...table.entries()]
            .filter(([, record]) => evictedRecords.has(record))
            .map(([key, record]) => ({ key, record }))
          for (const entry of evicted) {
            // C-5 (v18): the entries() snapshot and this delete are separate
            // operations, and the domain seam has no conditional write — a
            // concurrent savePending can re-mount the SAME key as a live
            // pending record in between (third-party/hand-written ids; in-tree
            // mounts use randomUUID). Re-read and refuse to evict unless the
            // record is still the resolved one the snapshot measured.
            const current = table.get(entry.key)
            const stillResolved = current !== undefined
              && (current.status === 'approved' || current.status === 'rejected')
              && current.resolvedAt === entry.record.resolvedAt
            if (!stillResolved) continue
            await table.delete(entry.key).catch((error: unknown) => {
              ctx.logger.warn(`evolution-state-domain: pending-cap eviction for "${entry.key}" failed (will retry on the next resolve): ${error instanceof Error ? error.message : String(error)}`)
            })
          }
        }
        const rawRecord: unknown = record
        if (resolved.record === null) {
          return { record: rawRecord === null ? null : structuredClone(rawRecord as PendingRecord), applied: false }
        }
        return { record: structuredClone(resolved.record), applied: true }
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
