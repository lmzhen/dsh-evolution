/**
 * Durable activity store for self-evolution plan outcomes.
 *
 * Adjudication (rc.42, A-line P0-1): plan outcomes are process events on the
 * cordis bus (a session log carrying `evolution/*` types is refused wholesale
 * at resume), so the retired session projection is replaced by this driver:
 * it subscribes to `evolution/plan-applied` (payload v2, with sessionId) and
 * persists every outcome to `$DSH_HOME/evolution/activity.json` through the
 * evolution IO seam — the same best-effort sidecar posture as
 * `feedback.json` and the curator reports. A storage-domain table is deferred
 * until a consumer needs domain routing (the domain spec version-gates its
 * media, so adding a table is not a free schema addition).
 *
 * The sidecar is append-merge (load → fold → save under an in-process queue),
 * so records survive host restarts and are readable without a session.
 * @module @deepseek-ai/dsh-evolution-activity
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { EvolutionIoLike, EvolutionPlanAppliedEvent } from '@deepseek-ai/dsh-evolution-core'
import { evolutionHome, evolutionIoAdapter, transactIo } from '@deepseek-ai/dsh-evolution-core'
import { join } from 'node:path'

/** One persisted plan outcome (payload v2 of `evolution/plan-applied`). */
export interface EvolutionActivityRecord {
  sessionId: string
  planId: string
  policyFingerprint?: string | undefined
  memoryApplied: number
  skillApplied: number
  rejectedOps: number
  /** R-03: ops skipped because the session never read the named skill — a third
   * "not done" cause that is neither a validation reject nor a failure. Optional
   * so payloads/sidecars without it keep parsing (absent = none recorded). */
  skippedUnread?: number | undefined
  /** V6-10 (0.3.36): execution-layer failures (not validation rejections) —
   * optional so pre-0.3.36 sidecars keep parsing (missing = none recorded). */
  executionFailures?: number | undefined
  executionError?: string | undefined
  evidenceQuotes?: number | undefined
  estimatedInputChars?: number | undefined
  at: number
}

/** Version of the `activity.json` shape; writers always emit the current one. */
export const ACTIVITY_FILE_VERSION = 2

/** Default bound on the retained sidecar (S6.4: also the fallback for a
 * non-finite `maxItems`). */
export const DEFAULT_MAX_ITEMS = 200

export function activityFile(root: string): string {
  return join(root, 'activity.json')
}

/** Fold one plan-applied payload into a bounded record list (pure). */
export function applyActivityEvent(
  items: EvolutionActivityRecord[],
  event: EvolutionPlanAppliedEvent,
  maxItems: number,
  at = Date.now(),
): EvolutionActivityRecord[] {
  // H-05: EVERY optional field is conditionally spread, so an absent
  // value leaves the key ABSENT instead of present-with-undefined — the same
  // 口径 as the executionFailures/executionError pair (V6-10). Previously
  // policyFingerprint/evidenceQuotes/estimatedInputChars were assigned
  // unconditionally, so `'x' in record` behaved asymmetrically across the
  // optional fields (a future bug seed for consumers keying on key presence;
  // JSON output was already identical since stringify drops undefined).
  const record: EvolutionActivityRecord = {
    sessionId: event.sessionId,
    planId: event.planId,
    ...event.policyFingerprint !== undefined ? { policyFingerprint: event.policyFingerprint } : {},
    memoryApplied: event.memoryApplied,
    skillApplied: event.skillApplied,
    rejectedOps: event.rejectedOps,
    // R-03: a plan whose ops were ALL skipped (session never read the skill)
    // has nothing accepted and nothing rejected — keep the third dimension.
    ...event.skippedUnread !== undefined ? { skippedUnread: event.skippedUnread } : {},
    // V6-10 (0.3.36): a plan that failed entirely at execution must not fold
    // into a clean "0/0" record — keep the failure dimension (V5-19 payload).
    ...event.executionFailures !== undefined ? { executionFailures: event.executionFailures } : {},
    ...event.executionError !== undefined ? { executionError: event.executionError } : {},
    ...event.evidenceQuotes !== undefined ? { evidenceQuotes: event.evidenceQuotes } : {},
    ...event.estimatedInputChars !== undefined ? { estimatedInputChars: event.estimatedInputChars } : {},
    at,
  }
  // A non-positive cap would disable the window entirely (`slice(-0)` keeps
  // everything), so it clamps to at least one record (rc.42 regression guard).
  // A non-finite cap (NaN/±Infinity) also disables the window (`slice(-NaN)`
  // keeps everything), so it falls back to the default bound (S6.4) — the
  // caller with a logger owns the diagnostic warn.
  const cap = Number.isFinite(maxItems) ? Math.max(1, maxItems) : DEFAULT_MAX_ITEMS
  return [...items, record].slice(-cap)
}

/** Single-source activity sidecar serialization (F-304): the `apply()`
 * listener emits the versioned envelope through this one function, so a
 * format change cannot drift across hand-written writers.
 * `parseActivityContent` is the matching single reader. */
export function serializeActivity(items: EvolutionActivityRecord[]): string {
  return JSON.stringify({ version: ACTIVITY_FILE_VERSION, items }, null, 2)
}

export function parseActivityContent(raw: string | null): EvolutionActivityRecord[] {
  if (raw === null) return []
  const isCount = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)
  // `at` is epoch-ms (finite number) — a hand-edited NaN/missing timestamp
  // would render as "Invalid Date" in every report.
  const isTimestampEpochMs = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)
  const isOptionalCount = (value: unknown): boolean => value === undefined || isCount(value)
  try {
    const parsed = JSON.parse(raw) as unknown
    const items = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : []
    return items.filter((item): item is EvolutionActivityRecord =>
      typeof item === 'object' && item !== null
      && typeof (item as EvolutionActivityRecord).planId === 'string'
      && typeof (item as EvolutionActivityRecord).sessionId === 'string'
      // P3-23 (v14): the op counters are consumed by numeric math downstream;
      // a malformed sidecar entry must be dropped rather than propagating NaN
      // (same finite-number discipline feedback applies to its own records).
      && isCount((item as EvolutionActivityRecord).memoryApplied)
      && isCount((item as EvolutionActivityRecord).skillApplied)
      && isCount((item as EvolutionActivityRecord).rejectedOps)
      // P3 (v15): `at` is the timestamp every report renders; the optional
      // numeric dimensions must stay finite for the same reason as the
      // counters. A hand-edited sidecar entry missing/NaN on any of these is
      // dropped instead of half-parsed.
      && isTimestampEpochMs((item as EvolutionActivityRecord).at)
      && isOptionalCount((item as EvolutionActivityRecord).skippedUnread)
      && isOptionalCount((item as EvolutionActivityRecord).executionFailures)
      && isOptionalCount((item as EvolutionActivityRecord).evidenceQuotes)
      && isOptionalCount((item as EvolutionActivityRecord).estimatedInputChars))
  } catch {
    // Unparsable bytes fold to empty so every READER stays total; the single
    // WRITE path (see apply) quarantines those bytes before it can overwrite
    // them, which is where the loss would actually happen.
    return []
  }
}

/**
 * H-06: the read barrier over the sidecar. V24-13 (v24): `loadActivity` now
 * HAS a production consumer — `evolution-replay` backfills its `/evolution
 * replay` leaderboard from this store at mount (the two packages'
 * "persistence is the activity store's job" contract is actually wired
 * through this call). The single-writer rule is unchanged: `apply()`'s
 * transact listener remains the only WRITE path.
 */
/**
 * FLOW6-6 (v43, the read side of H-3): the sidecar's records PLUS whether the
 * bytes could be read as THIS format. `parseActivityContent` answers `[]` for
 * a future-version or unparsable file, so a read-only consumer could not tell
 * "newer format" from "no history" and presented a partial/empty view as the
 * recorded truth. The write side already quarantines those bytes
 * ({@link isCorruptActivity}); this is the channel the readers were missing.
 */
export interface ActivityLoad {
  records: EvolutionActivityRecord[]
  /** Bytes exist but are not a readable current-version envelope. A MISSING
   * file is not corruption — it is a first write. */
  corrupt: boolean
}

/**
 * H-06: the read barrier over the sidecar, with the corruption verdict.
 *
 * @param root - the evolution state root (the sidecar lives under it).
 * @param io - the IO provider to read through.
 * @returns the parsed records and whether the bytes were readable.
 */
export async function loadActivityState(root: string, io: EvolutionIoLike): Promise<ActivityLoad> {
  const raw = await io.readText(activityFile(root))
  return { records: parseActivityContent(raw), corrupt: isCorruptActivity(raw) }
}

/**
 * H-06: the read barrier over the sidecar. V24-13 (v24): `loadActivity` now
 * HAS a production consumer — `evolution-replay` backfills its `/evolution
 * replay` leaderboard from this store at mount (the two packages'
 * "persistence is the activity store's job" contract is actually wired
 * through this call). The single-writer rule is unchanged: `apply()`'s
 * transact listener remains the only WRITE path. Consumers that must not read
 * an unreadable sidecar as "no history" use {@link loadActivityState}.
 */
export async function loadActivity(root: string, io: EvolutionIoLike): Promise<EvolutionActivityRecord[]> {
  return (await loadActivityState(root, io)).records
}

/** True when bytes exist but are not a readable activity envelope: unparsable
 * JSON, or a missing `items` array (a scalar/array/other-shaped file). A missing
 * file (null) is NOT corruption — it is a first write. */
/**
 * v43 audit (H-3 / J-6 / FLOW6-6): an UNSUPPORTED version is corrupt for this
 * writer. The read side has always ignored `version` and taken `items` as-is,
 * so a future-version sidecar used to fold fine and then be rewritten as
 * `version: ACTIVITY_FILE_VERSION` on the next append — a silent downgrade that
 * destroyed whatever the newer format carried. This guard is the write side's
 * half of the pair: unknown version ⇒ the original bytes are quarantined (the
 * existing `.corrupt` path) before a current-version file replaces them, which
 * is the posture `evolution-events` already takes for the same shape.
 * Residual, closed by FLOW6-6: `parseActivityContent` still answers `[]` for
 * such a file, but {@link loadActivityState} now carries the verdict beside the
 * records, so a read-only consumer can distinguish "newer format" from "no
 * history" instead of presenting a partial view as the recorded truth.
 * @internal Exported for this package's own tests (siblings `parseActivityContent`
 * and `serializeActivity` are exported for the same reason).
 */
export function isCorruptActivity(raw: string | null): boolean {
  if (raw === null) return false
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { items?: unknown }).items)) return true
    const version = (parsed as { version?: unknown }).version
    return version !== undefined && version !== ACTIVITY_FILE_VERSION
  } catch {
    // Unparsable bytes are exactly the corruption this guard exists for.
    return true
  }
}

export const name = 'evolution-activity'

export interface Config {
  /** Bounded sidecar: how many recent outcomes are kept. */
  maxItems?: number
}

export const Config: z<Config> = z.object({
  // G3.1 (0.3.23): a non-positive bound would disable the retention window
  // (`slice(-0)` keeps everything), so 0/negative fail loud at the schema. The
  // assembly-time S6.4 clamp (non-finite -> default) covers NaN/±Infinity,
  // which a bare `z.number()` lets through.
  maxItems: z.number().min(1).default(DEFAULT_MAX_ITEMS),
})

export function apply(ctx: Context, rawConfig: Config = {}): void {
  // S6.4: a non-finite `maxItems` (NaN slips through `z.number()` since
  // `typeof NaN === 'number'`) would disable the window; resolve it once here,
  // warn when it was bad, and let the pure fold fall back for direct callers.
  const configuredMaxItems = rawConfig.maxItems ?? DEFAULT_MAX_ITEMS
  let maxItems: number
  if (!Number.isFinite(configuredMaxItems)) {
    maxItems = DEFAULT_MAX_ITEMS
    ctx.logger.warn(`evolution-activity: maxItems is not a finite number; falling back to the default ${DEFAULT_MAX_ITEMS}`)
  } else if (configuredMaxItems < 1) {
    // V4-42: the schema `.min(1)` rejects 0/negative on the loader path, but a
    // direct/programmatic assembly can bypass it. A non-positive bound would
    // disable the window (`slice(-0)` keeps everything), so clamp to 1 and warn
    // — the same loud posture the other family packages apply to a 0 config.
    maxItems = 1
    ctx.logger.warn(`evolution-activity: maxItems=${String(configuredMaxItems)} is invalid; falling back to 1`)
  } else {
    maxItems = configuredMaxItems
  }
  // Deferred binding (S6.4, tool-* pattern): subscribe only once the evolution
  // IO provider mounts, so a provider registered after this plugin still wires
  // persistence instead of being skipped by an apply-time probe. Without the
  // provider the listener never registers, matching the previous no-op.
  ctx.inject(['evolutionIo'], (ioCtx) => {
    const ioRegistry = (ioCtx as unknown as { evolutionIo: { provider(): EvolutionIoLike } }).evolutionIo
    // Lazy adapter: forwards transact (N-4) when the backend provides it — the
    // fold then runs inside one cross-process lock, so a second process sharing
    // DSH_HOME cannot interleave between our read and write.
    const io = evolutionIoAdapter(() => ioRegistry.provider())
    const root = evolutionHome()
    // In-process serialization: each event is one transactIo cycle, so
    // concurrent outcomes in THIS process can never overwrite each other's
    // newest record (the backend lock covers other processes).
    let chain: Promise<unknown> = Promise.resolve()
    ioCtx.on('evolution/plan-applied', (event) => {
      const run = chain.then(() =>
        transactIo(io, activityFile(root), async (current) => {
          const file = activityFile(root)
          if (isCorruptActivity(current)) {
            // P2-15: folding would restart from [] and overwrite bytes that are
            // still recoverable — quarantine them first (state-json/usage posture).
            const rescued = await io.writeText(`${file}.corrupt`, current as string).then(() => true, () => false)
            if (!rescued) {
              ioCtx.logger.warn(`evolution-activity: ${file} is unreadable; the .corrupt copy could not be written — refusing this write so the original bytes stay recoverable`)
              return current
            }
            ioCtx.logger.warn(`evolution-activity: ${file} is unreadable (unparsable JSON or wrong top-level shape); the original bytes were copied to ${file}.corrupt and the store restarts from the readable entries`)
          }
          const items = applyActivityEvent(parseActivityContent(current), event, maxItems)
          return serializeActivity(items)
        }),
      )
      chain = run.then(() => undefined, () => undefined)
      run.catch((error: unknown) => {
        // Persistence is best-effort: the outcome was already applied upstream.
        ioCtx.logger.warn(error instanceof Error ? error : String(error))
      })
    })
  })
}
