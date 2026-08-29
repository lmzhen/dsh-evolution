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
  evidenceQuotes?: number | undefined
  estimatedInputChars?: number | undefined
  at: number
}

/** Version of the `activity.json` shape; writers always emit the current one. */
export const ACTIVITY_FILE_VERSION = 2

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
  const record: EvolutionActivityRecord = {
    sessionId: event.sessionId,
    planId: event.planId,
    policyFingerprint: event.policyFingerprint,
    memoryApplied: event.memoryApplied,
    skillApplied: event.skillApplied,
    rejectedOps: event.rejectedOps,
    evidenceQuotes: event.evidenceQuotes,
    estimatedInputChars: event.estimatedInputChars,
    at,
  }
  // A non-positive cap would disable the window entirely (`slice(-0)` keeps
  // everything), so it clamps to at least one record (rc.42 regression guard).
  const cap = Math.max(1, maxItems)
  return [...items, record].slice(-cap)
}

/** Parse a raw sidecar into records; malformed content reads as empty (best-effort telemetry). */
export function parseActivityContent(raw: string | null): EvolutionActivityRecord[] {
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    const items = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : []
    return items.filter((item): item is EvolutionActivityRecord =>
      typeof item === 'object' && item !== null
      && typeof (item as EvolutionActivityRecord).planId === 'string'
      && typeof (item as EvolutionActivityRecord).sessionId === 'string')
  } catch {
    // Malformed sidecar is treated as empty; observability is best-effort.
    return []
  }
}

export async function loadActivity(root: string, io: EvolutionIoLike): Promise<EvolutionActivityRecord[]> {
  return parseActivityContent(await io.readText(activityFile(root)))
}

export async function saveActivity(root: string, items: EvolutionActivityRecord[], io: EvolutionIoLike): Promise<void> {
  await io.writeText(activityFile(root), JSON.stringify({ version: ACTIVITY_FILE_VERSION, items }, null, 2))
}

export const name = 'evolution-activity'

export interface Config {
  /** Bounded sidecar: how many recent outcomes are kept. */
  maxItems?: number
}

export const Config: z<Config> = z.object({
  maxItems: z.number().default(200),
})

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const maxItems = rawConfig.maxItems ?? 200
  const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
  if (!ioRegistry) {
    ctx.logger.warn('evolution-activity: no evolution IO provider mounted; plan outcomes will not be persisted')
    return
  }
  // Lazy adapter: forwards transact (N-4) when the backend provides it — the
  // fold then runs inside one cross-process lock, so a second process sharing
  // DSH_HOME cannot interleave between our read and write.
  const io = evolutionIoAdapter(() => ioRegistry.provider())
  const root = evolutionHome()
  // In-process serialization: each event is one transactIo cycle, so
  // concurrent outcomes in THIS process can never overwrite each other's
  // newest record (the backend lock covers other processes).
  let chain: Promise<unknown> = Promise.resolve()
  ctx.on('evolution/plan-applied', (event) => {
    const run = chain.then(() =>
      transactIo(io, activityFile(root), (current) => {
        const items = applyActivityEvent(parseActivityContent(current), event, maxItems)
        return Promise.resolve(JSON.stringify({ version: ACTIVITY_FILE_VERSION, items }, null, 2))
      }),
    )
    chain = run.then(() => undefined, () => undefined)
    run.catch((error: unknown) => {
      // Persistence is best-effort: the outcome was already applied upstream.
      ctx.logger.warn(error instanceof Error ? error : String(error))
    })
  })
}
