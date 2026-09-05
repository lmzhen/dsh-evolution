/**
 * Self-evolution event log (rc.68): an append-only sidecar under
 * `$DSH_HOME/evolution/events.json` that is the single source of truth for
 * the self-improvement loop. Feedback increments and learn actions share one
 * ordered timeline (`seq` is the ordering key), so "feedback before/after a
 * learn on target X" is answerable. The aggregate `feedback.json` is a
 * rebuildable boot cache, never the truth.
 *
 * Usage events (C semantics, rc.73+): `type:'usage'` records are the
 * OBSERVATION WINDOW ANCHOR — written once, when the library's first observed
 * read (`view_count` 0 -> 1) happens. Before that anchor the usage sidecar
 * has no read evidence (reads were invisible pre-A2), so churn-based health
 * judgments are NOT trustworthy; the curator suppresses them (its
 * `usageObserved()` gate) until the anchor exists. `counts` on the event is a
 * cumulative library-wide snapshot (skills/views/use/patches) at that moment,
 * and `window.opened` pins the window start for the timeline.
 *
 * Rotation (rc.71, 007 design): when the active log reaches
 * `EVENT_LOG_ROTATE_AT` the older half is split into an archive
 * (`events-<lastArchivedSeq>.json`); the boot timeline merges active +
 * archives and dedupes by seq (active copy wins), so the rotation crash window
 * yields the identical timeline. Archival naming is STRICTLY numeric
 * (`/^events-\d+\.json$/`) — user files under the same directory are never
 * read as archives and never pruned (rc.72 G-2).
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

/** Archive naming is strictly numeric: a user file such as `events-backup.json`
 * under the same directory is neither read into the timeline nor pruned. */
const EVENT_ARCHIVE_RE = /^events-(\d+)\.json$/

export interface EvolutionEvent {
  /** Global monotonic order key, assigned inside the append transact. */
  seq: number
  /** ISO timestamp at append time. */
  at: string
  /** Tagged-union discriminator: feedback increments, learn actions, usage
   * observation anchors (C semantics: `usage` events carry the library-wide
   * count snapshot at the moment the observation window opened), and
   * maintain scans (011: verdict + recommendation count + runId). */
  type: 'feedback' | 'learn' | 'usage' | 'maintain'
  target?: string | undefined
  kind?: 'skill' | 'session' | undefined
  rating?: 'positive' | 'negative' | undefined
  note?: string | undefined
  source?: string | undefined
  request?: string | undefined
  runId?: string | undefined
  verdict?: string | undefined
  recommendations?: number | undefined
  /** Library-wide usage totals (usage events; counts are cumulative, not deltas). */
  counts?: { skills?: number; views?: number; use?: number; patches?: number } | undefined
  /** Anchor fields for one event (usage: the observation window). */
  window?: { opened?: string } | undefined
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
 * This reader is **v1-only** (F-338): a body carrying a `version` other than
 * `EVENT_LOG_VERSION` is a future-format log this reader cannot interpret, so
 * it reads as an EMPTY timeline rather than being mis-parsed as v1. The read
 * side never overwrites it on its own — `appendEvolutionEvent` rejects a
 * version mismatch up front and preserves the original bytes, so a newer log
 * is never silently downgraded here.
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
    // v1-only reader: an explicit non-current version is a future format (or a
    // corrupt version field) and must not be shaped as v1. A missing `version`
    // is tolerated as legacy v1.
    if (parsed.version !== undefined && parsed.version !== EVENT_LOG_VERSION) return []
    if (!Array.isArray(parsed.events)) return []
    return parsed.events.filter(isEventRecord)
  } catch {
    return []
  }
}

/**
 * List the numeric archives under the log's directory, sorted ascending by
 * their last-archived seq. Single glob predicate for the timeline, the
 * retention pass and the feedback migration check (rc.72 H-3).
 */
export async function listEventArchives(io: EvolutionIoLike, path: string): Promise<string[]> {
  const dir = dirname(path)
  const names = await io.list(dir)
  return names
    .filter(name => EVENT_ARCHIVE_RE.test(name))
    .sort((a, b) => {
      const sa = Number.parseInt(a.slice(EVENT_ARCHIVE_PREFIX.length, a.length - 5), 10)
      const sb = Number.parseInt(b.slice(EVENT_ARCHIVE_PREFIX.length, b.length - 5), 10)
      return sa - sb
    })
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
 *
 * rc.72 G-1: when the ACTIVE is missing/whitespace but archives exist (a
 * deleted active, or B-2 self-heal), seq derivation consults the archive names
 * — the active restarts AFTER the highest archived seq, never at 1, so a new
 * event can never shadow an archived one in the seq-deduped timeline.
 */
export async function appendEvolutionEvent(io: EvolutionIoLike, path: string, event: Omit<EvolutionEvent, 'seq' | 'at'>, rotateAt = EVENT_LOG_ROTATE_AT): Promise<number> {
  let assigned = 0
  // Empty when the append was refused as malformed; set when it was refused
  // because the log carries a future `version` (F-338). Kept as a prebuilt
  // message so a closure-side assignment is never narrowed to `never` by the
  // outer control flow.
  let refuseMessage = ''
  await transactIo(io, path, async (current) => {
    // rc.69: a whitespace-only log (crash residue) is rebuildable — treat it
    // as missing; a genuinely corrupt body is still refused.
    if (current !== null && current.trim() !== '') {
      let shape: { version?: unknown }
      try { shape = JSON.parse(current) as { version?: unknown } } catch { return current }
      // F-338: a non-v1 body is a FUTURE format. This v1 writer must never
      // rewrite it back down to v1 — refuse and keep the original bytes. (The
      // reader treats it as an empty timeline; only the append refuses.)
      if (shape.version !== undefined && shape.version !== EVENT_LOG_VERSION) {
        const found = typeof shape.version === 'number' || typeof shape.version === 'string' ? String(shape.version) : 'unknown'
        refuseMessage = `evolution event log version mismatch (found ${found}, expected ${EVENT_LOG_VERSION}) and was not touched`
        return current
      }
    }
    const events = parseEvolutionEvents(current)
    const nextEvents = await rotateIfDue(io, path, events, rotateAt)
    let maxSeq = nextEvents.reduce((max, entry) => Math.max(max, entry.seq), 0)
    if (maxSeq === 0) {
      // The active is empty/missing: seq continues from the highest ARCHIVE
      // name (archives always carry lower seqs than a present active, so this
      // branch is only reached when the active is gone or newly rebuilt).
      for (const name of await listEventArchives(io, path)) {
        maxSeq = Math.max(maxSeq, Number.parseInt(name.slice(EVENT_ARCHIVE_PREFIX.length, name.length - 5), 10))
      }
    }
    const record: EvolutionEvent = { ...event, seq: maxSeq + 1, at: new Date().toISOString() }
    assigned = record.seq
    return JSON.stringify({ version: EVENT_LOG_VERSION, events: [...nextEvents, record] }, null, 2)
  })
  if (assigned === 0) {
    throw new Error(`${refuseMessage || 'evolution event log is malformed and was not touched'}: ${path}`)
  }
  return assigned
}

/**
 * Split the active log at its midpoint when due: the older half is written to
 * `events-<lastArchivedSeq>.json` (await — a failed archive write aborts the
 * append so the active is never truncated without its copy), old archives are
 * pruned, and the newer half is returned as the next active body. No-op when
 * under the threshold; `rotateAt < 2` is a guarded no-op (rc.72 G-1: a
 * one-event rotate would archive everything and restart seqs at 1).
 */
async function rotateIfDue(io: EvolutionIoLike, path: string, events: EvolutionEvent[], rotateAt: number): Promise<EvolutionEvent[]> {
  if (rotateAt < 2 || events.length < rotateAt) return events
  const mid = Math.ceil(events.length / 2)
  const head = events.slice(0, mid)
  const tail = events.slice(mid)
  if (tail.length === 0) return events
  const anchor = tail[0]?.seq ?? 0
  const archivePath = join(dirname(path), `${EVENT_ARCHIVE_PREFIX}${anchor - 1}.json`)
  await io.writeText(archivePath, JSON.stringify({ version: EVENT_LOG_VERSION, events: head }, null, 2))
  await retainEventArchives(io, path)
  return tail
}

/**
 * Prune old event archives (rc.71): keep the newest `EVENT_LOG_RETAIN_ARCHIVES`.
 * The name's numeric part is the last archived seq, so ordering is NUMERIC —
 * lexicographic would rank `events-10` before `events-2`. Only strictly
 * numeric names participate (rc.72 G-2: user files are never deleted).
 * Best-effort per removal; exported for the retention test.
 */
export async function retainEventArchives(io: EvolutionIoLike, path: string): Promise<void> {
  const dir = dirname(path)
  const names = await listEventArchives(io, path)
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
   * append (rc.70 F-1: read and append agree on the same boundary). A READ
   * error (EISDIR etc.) also flags malformed — the file is unusable either
   * way and is never overwritten (the append read would fail identically). */
  malformed: boolean
}

/** Read the event log; a missing/whitespace-only file reads as empty,
 * corrupt content is flagged (and refused on append). A well-formed future-
 * version body is v1-incompatible and reads as empty, NOT malformed (F-338:
 * the reader must never mis-shape a newer format; the append path refuses it
 * up front so the original bytes survive). */
export async function readEvolutionEvents(io: EvolutionIoLike, path: string): Promise<EventLogRead> {
  let raw: string | null
  try {
    raw = await io.readText(path)
  } catch {
    return { events: [], malformed: true }
  }
  if (raw === null || raw.trim() === '') return { events: [], malformed: false }
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; events?: unknown }
    // v1-only reader (F-338): a non-current `version` is a future format that
    // must not be shaped as v1. Reads as empty (replaceable in principle) but
    // the append path rejects it before writing, so nothing is overwritten.
    if (parsed.version !== undefined && parsed.version !== EVENT_LOG_VERSION) return { events: [], malformed: false }
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
 * malformed (or unreadable) ARCHIVE is skipped — it never bricks the boot and
 * it is still flagged.
 */
export async function readEvolutionTimeline(io: EvolutionIoLike, path: string): Promise<EventLogRead> {
  const dir = dirname(path)
  let malformed = false
  const bySeq = new Map<number, EvolutionEvent>()
  for (const name of await listEventArchives(io, path)) {
    const read = await readEvolutionEvents(io, join(dir, name))
    if (read.malformed) malformed = true
    for (const event of read.events) bySeq.set(event.seq, event)
  }
  const active = await readEvolutionEvents(io, path)
  if (active.malformed) malformed = true
  for (const event of active.events) bySeq.set(event.seq, event)
  return { events: [...bySeq.values()].sort((a, b) => a.seq - b.seq), malformed }
}
