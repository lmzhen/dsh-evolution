/**
 * Self-evolution event log (rc.68): an append-only sidecar under
 * `$DSH_HOME/evolution/events.json` that is the single source of truth for
 * the self-improvement loop. Feedback increments and learn actions share one
 * ordered timeline (`seq` is the ordering key), so "feedback before/after a
 * learn on target X" is answerable. The aggregate `feedback.json` is a
 * rebuildable boot cache, never the truth.
 *
 * The malformed-refusal posture matches the whole sidecar family (rc.65): an
 * append NEVER rewrites a corrupt log — the bytes stay untouched.
 */

import { transactIo, type EvolutionIoLike } from './io.ts'
import { dirname, join } from 'node:path'

export const EVENT_LOG_VERSION = 1

/** Active-log split point (rc.71): when the active log reaches this many events
 * the older half is rotated into an archive; the active stays bounded so a
 * single append stays O(active) instead of O(total-history). Tunable default —
 * callers may override per append (the tests use small values). */
export const EVENT_LOG_ROTATE_AT = 4000

/** Number of archives retained (rc.71): older archives are pruned at rotation,
 * mirroring retainReports. The horizon covers the loop-analysis window. */
export const EVENT_LOG_RETAIN_ARCHIVES = 10

/** Archive file prefix: `events-<lastArchivedSeq>.json`. The active file is
 * `events.json` and never matches this glob. */
export const EVENT_ARCHIVE_PREFIX = 'events-'

export interface EvolutionEvent {
  /** Global monotonic order key, assigned inside the append transact. */
  seq: number
  /** ISO timestamp at append time. */
  at: string
  /** Tagged-union discriminator: feedback increments vs learn actions. */
  type: 'feedback' | 'learn'
  target?: string | undefined
  kind?: 'skill' | 'session' | undefined
  rating?: 'positive' | 'negative' | undefined
  note?: string | undefined
  source?: string | undefined
  request?: string | undefined
}

export function eventsFile(home: string): string {
  return join(home, 'evolution', 'events.json')
}

function isEventRecord(event: unknown): event is EvolutionEvent {
  return typeof event === 'object' && event !== null && typeof (event as { seq?: unknown }).seq === 'number'
}

/**
 * Parse an event log body. A missing file, a whitespace-only file (rc.69:
 * rebuildable, NOT malformed) or a corrupt one reads as empty; corrupt content
 * is still refused on append, never overwritten.
 *
 * Per-entry normalization (rc.70 F-1): entries without a numeric `seq` are
 * skipped here and dropped at the next append — valid entries survive, the
 * damaged record is the only loss (self-heal semantics, matching the usage
 * sidecar's per-field normalization on read).
 */
export function parseEvolutionEvents(raw: string | null): EvolutionEvent[] {
  if (raw === null || raw.trim() === '') return []
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; events?: unknown }
    if (!Array.isArray(parsed.events)) return []
    return parsed.events.filter(isEventRecord)
  } catch {
    return []
  }
}

/**
 * Append one event under the write lock (rc.68): `seq` = current max + 1
 * computed inside the transact, so two processes appending concurrently never
 * collide. A malformed log is refused (bytes preserved) and the append fails.
 * Returns the assigned seq.
 *
 * Rotation (rc.71, 007 design): when the active log reaches `rotateAt`, the
 * older half is copied into an archive inside the SAME transact (the archive
 * path has its own lock, so no recursion) and the active is replaced with the
 * newer half + the new event. seqs stay globally monotonic; a crash between
 * archive write and active write leaves both copies, which the timeline merge
 * dedupes by seq. An archive-write failure aborts the append (active keeps the
 * full old content — no loss) and the caller's best-effort handling applies.
 */
export async function appendEvolutionEvent(io: EvolutionIoLike, path: string, event: Omit<EvolutionEvent, 'seq' | 'at'>, rotateAt = EVENT_LOG_ROTATE_AT): Promise<number> {
  let assigned = 0
  await transactIo(io, path, async (current) => {
    // rc.69: a whitespace-only log (crash residue) is rebuildable — treat it
    // as missing; a genuinely corrupt body is still refused.
    if (current !== null && current.trim() !== '') {
      try { JSON.parse(current) } catch { return current }
    }
    const events = parseEvolutionEvents(current)
    const nextEvents = await rotateIfDue(io, path, events, rotateAt)
    const maxSeq = nextEvents.reduce((max, entry) => Math.max(max, entry.seq), 0)
    const record: EvolutionEvent = { ...event, seq: maxSeq + 1, at: new Date().toISOString() }
    assigned = record.seq
    return JSON.stringify({ version: EVENT_LOG_VERSION, events: [...nextEvents, record] }, null, 2)
  })
  if (assigned === 0) throw new Error(`evolution event log is malformed and was not touched: ${path}`)
  return assigned
}

/**
 * Split the active log at its midpoint when due: the older half is written to
 * `events-<lastArchivedSeq>.json` (await — a failed archive write aborts the
 * append so the active is never truncated without its copy), old archives are
 * pruned, and the newer half is returned as the next active body. No-op when
 * under the threshold.
 */
async function rotateIfDue(io: EvolutionIoLike, path: string, events: EvolutionEvent[], rotateAt: number): Promise<EvolutionEvent[]> {
  if (events.length < rotateAt) return events
  const mid = Math.ceil(events.length / 2)
  const head = events.slice(0, mid)
  const tail = events.slice(mid)
  const anchor = tail[0]?.seq ?? (events[events.length - 1]?.seq ?? 0)
  const archivePath = join(dirname(path), `${EVENT_ARCHIVE_PREFIX}${anchor - 1}.json`)
  await io.writeText(archivePath, JSON.stringify({ version: EVENT_LOG_VERSION, events: head }, null, 2))
  await retainEventArchives(io, path)
  return tail
}

/**
 * Prune old event archives (rc.71): keep the newest `EVENT_LOG_RETAIN_ARCHIVES`.
 * The name's numeric part is the last archived seq, so ordering is NUMERIC —
 * lexicographic would rank `events-10` before `events-2`. Best-effort per
 * removal; exported for the retention test.
 */
export async function retainEventArchives(io: EvolutionIoLike, path: string): Promise<void> {
  const dir = dirname(path)
  const names = (await io.list(dir))
    .filter(name => name.startsWith(EVENT_ARCHIVE_PREFIX) && name.endsWith('.json'))
  const archiveSeq = (name: string): number => Number.parseInt(name.slice(EVENT_ARCHIVE_PREFIX.length, name.length - 5), 10) || 0
  names.sort((a, b) => archiveSeq(a) - archiveSeq(b))
  const excess = names.slice(0, Math.max(0, names.length - EVENT_LOG_RETAIN_ARCHIVES))
  for (const name of excess) {
    await io.remove(join(dir, name)).catch(() => {})
  }
}

export interface EventLogRead {
  events: EvolutionEvent[]
  /** True when the body is not valid JSON (syntax-level damage): refused on
   * append, bytes untouched. Well-formed JSON with a damaged `events` field
   * is REPLACEABLE garbage — reads as empty and is rewritten at the next
   * append (rc.70 F-1: read and append agree on the same boundary). */
  malformed: boolean
}

/** Read the event log; a missing/whitespace-only file reads as empty,
 * corrupt content is flagged (and refused on append). */
export async function readEvolutionEvents(io: EvolutionIoLike, path: string): Promise<EventLogRead> {
  const raw = await io.readText(path)
  if (raw === null || raw.trim() === '') return { events: [], malformed: false }
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; events?: unknown }
    // Shape damage is replaceable garbage (read as empty, rebuilt on append);
    // only syntax-level damage is "malformed" (never overwritten).
    if (!Array.isArray(parsed.events)) return { events: [], malformed: false }
    return {
      events: parsed.events.filter(isEventRecord),
      malformed: false,
    }
  } catch {
    return { events: [], malformed: true }
  }
}

/**
 * Read the full timeline (rc.71): active log + all archives, merged by seq
 * (active copy wins, duplicates only arise from the rotation crash window),
 * sorted ascending. Per-file malformed flag as in `readEvolutionEvents`; a
 * malformed ARCHIVE is skipped (never bricks the boot) and still flagged.
 */
export async function readEvolutionTimeline(io: EvolutionIoLike, path: string): Promise<EventLogRead> {
  const dir = dirname(path)
  const names = (await io.list(dir))
    .filter(name => name.startsWith(EVENT_ARCHIVE_PREFIX) && name.endsWith('.json'))
    .sort()
  let malformed = false
  const bySeq = new Map<number, EvolutionEvent>()
  for (const name of names) {
    const read = await readEvolutionEvents(io, join(dir, name))
    if (read.malformed) malformed = true
    for (const event of read.events) bySeq.set(event.seq, event)
  }
  const active = await readEvolutionEvents(io, path)
  if (active.malformed) malformed = true
  for (const event of active.events) bySeq.set(event.seq, event)
  return { events: [...bySeq.values()].sort((a, b) => a.seq - b.seq), malformed }
}
