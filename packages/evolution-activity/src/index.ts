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
import type { EvolutionPlanAppliedEvent } from '@deepseek-ai/dsh-evolution-core'
import { evolutionHome } from '@deepseek-ai/dsh-evolution-core'
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

/** Minimal IO surface the driver needs (subset of `EvolutionIoLike`). */
export interface ActivityIoLike {
  readText(path: string): Promise<string | null>
  writeText(path: string, content: string): Promise<void>
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
  return [...items, record].slice(-maxItems)
}

export async function loadActivity(root: string, io: ActivityIoLike): Promise<EvolutionActivityRecord[]> {
  const raw = await io.readText(activityFile(root))
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

export async function saveActivity(root: string, items: EvolutionActivityRecord[], io: ActivityIoLike): Promise<void> {
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
  const ioRegistry = ctx.get('evolutionIo') as { provider(): ActivityIoLike } | undefined
  if (!ioRegistry) {
    ctx.logger.warn('evolution-activity: no evolution IO provider mounted; plan outcomes will not be persisted')
    return
  }
  const io: ActivityIoLike = {
    readText: path => ioRegistry.provider().readText(path),
    writeText: (path, content) => ioRegistry.provider().writeText(path, content),
  }
  const root = evolutionHome()
  // In-process serialization: each event is one load→fold→save cycle, so
  // concurrent outcomes can never overwrite each other's newest record.
  let chain: Promise<unknown> = Promise.resolve()
  ctx.on('evolution/plan-applied', (event) => {
    const run = chain.then(async () => {
      const items = await loadActivity(root, io)
      await saveActivity(root, applyActivityEvent(items, event, maxItems), io)
    })
    chain = run.then(() => undefined, () => undefined)
    run.catch((error: unknown) => {
      // Persistence is best-effort: the outcome was already applied upstream.
      ctx.logger.warn(error instanceof Error ? error : String(error))
    })
  })
}
