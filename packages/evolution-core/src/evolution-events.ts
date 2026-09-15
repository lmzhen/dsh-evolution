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
 * read (`view_count` 0 -> 1) happens. The anchor is the durable timeline record
 * of that moment: the churn-suppression gate itself (`usageObserved()`) reads
 * the usage SIDECAR's own first-view evidence, since reads were invisible to it
 * pre-A2 and no sidecar record can reach `view_count > 0` without the same
 * 0 -> 1 transition. `counts` on the event is a cumulative library-wide
 * snapshot (skills/views/use/patches) at that moment, and `window.opened` pins
 * the window start for the timeline. (V27 G3.3: `verify-event-pairing` requires
 * every persisted type to have a production reader or a declared external
 * contract — this one is the latter.)
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
  /** Fold key for a `feedback` event: required and non-empty there (P2-10),
   * optional on the other tags and on a record this version only reads. */
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

/** The durable-write shape of one event: `feedback` REQUIRES a `target` —
 * the fold key the aggregate is keyed by (P2-10). The other tags keep every
 * field optional, exactly as the runtime payload gate treats them. */
type EvolutionEventInput =
  | (Omit<EvolutionEvent, 'seq' | 'at' | 'target'> & { type: 'feedback'; target: string })
  | (Omit<EvolutionEvent, 'seq' | 'at'> & { type: 'learn' | 'usage' | 'maintain' })

export function eventsFile(home: string): string {
  return join(home, 'evolution', 'events.json')
}

/** I-5 (v18): one lightweight description of the durable event payload
 * contract. The log is a FILE boundary (a host, a script or an older version
 * can write it), so `appendEvolutionEvent` refuses a record no consumer can
 * fold instead of persisting it and failing silently later. The process event
 * bus stays unvalidated — that is a typed same-process boundary.
 * @param event - the candidate event record.
 * @returns a human-readable issue, or null when the record is well-formed.
 */
export function evolutionEventPayloadIssue(event: { type?: unknown } & Partial<EvolutionEvent>): string | null {
  const type = event.type
  // `type` is `unknown` on purpose: at this FILE boundary the static union is
  // not a guarantee, so a non-member (or non-string) is reported.
  if (typeof type !== 'string') return `unknown event type "${String(type)}"`
  switch (type) {
    case 'feedback':
      if (event.kind !== 'skill' && event.kind !== 'session') return 'feedback event requires kind skill|session'
      if (event.rating !== 'positive' && event.rating !== 'negative') return 'feedback event requires rating positive|negative'
      // P2-10 (v37): target is the fold key — the only folder skips a
      // target-less feedback silently and `target: ''` folds a phantom key, so
      // neither may pass this durable boundary.
      if (typeof event.target !== 'string' || event.target.trim() === '') return 'feedback event requires a non-empty target'
      return null
    case 'maintain':
      return typeof event.runId === 'string' ? null : 'maintain event requires runId'
    case 'learn':
    case 'usage':
      return null
    default:
      // Unreachable for the declared union; reachable when a JS host writes
      // the file. The cast restores the runtime value the union erased.
      return `unknown event type "${type as string}"`
  }
}

function isEventRecord(event: unknown): event is EvolutionEvent {
  // C-05: NaN passed the bare typeof check — a NaN seq became a Map
  // key that never matches and a sort comparator that never orders. Only a
  // finite number is a seq.
  const seq = (event as { seq?: unknown } | null | undefined)?.seq
  return typeof event === 'object' && event !== null && typeof seq === 'number' && Number.isFinite(seq)
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
/**
 * Post-parse v1 gate shared by parseEvolutionEvents and appendEvolutionEvent
 * (C-06, v10 audit: the append used to JSON.parse the same body a second time
 * through parseEvolutionEvents — double parse cost per append). A null parse
 * (missing/whitespace/unparsable body) reads as an empty timeline.
 */
function v1EventRecords(parsed: { version?: unknown; events?: unknown } | null): EvolutionEvent[] {
  if (parsed === null) return []
  // v1-only reader: an explicit non-current version is a future format (or a
  // corrupt version field) and must not be shaped as v1. A missing `version`
  // is tolerated as legacy v1.
  if (parsed.version !== undefined && parsed.version !== EVENT_LOG_VERSION) return []
  if (!Array.isArray(parsed.events)) return []
  return parsed.events.filter(isEventRecord)
}

export function parseEvolutionEvents(raw: string | null): EvolutionEvent[] {
  if (raw === null || raw.trim() === '') return []
  try {
    return v1EventRecords(JSON.parse(raw) as { version?: unknown; events?: unknown })
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
export async function appendEvolutionEvent(
  io: EvolutionIoLike,
  path: string,
  event: EvolutionEventInput,
  rotateAt = EVENT_LOG_ROTATE_AT,
): Promise<number> {
  // I-5 (v18): refuse an unfoldable record at the durable write boundary.
  const issue = evolutionEventPayloadIssue(event)
  if (issue !== null) throw new Error(`evolution event refused: ${issue}`)
  let assigned = 0
  // Empty when the append was refused as malformed; set when it was refused
  // because the log carries a future `version` (F-338). Kept as a prebuilt
  // message so a closure-side assignment is never narrowed to `never` by the
  // outer control flow.
  let refuseMessage = ''
  // C-06 (v10 audit): the shape parse below is REUSED for the event list via
  // v1EventRecords — the body used to be JSON.parsed twice per append.
  let parsedBody: { version?: unknown; events?: unknown } | null = null
  await transactIo(io, path, async (current) => {
    // rc.69: a whitespace-only log (crash residue) is rebuildable — treat it
    // as missing; a genuinely corrupt body is still refused.
    if (current !== null && current.trim() !== '') {
      let shape: { version?: unknown; events?: unknown }
      try { shape = JSON.parse(current) as { version?: unknown; events?: unknown } } catch { return current }
      parsedBody = shape
      // F-338: a non-v1 body is a FUTURE format. This v1 writer must never
      // rewrite it back down to v1 — refuse and keep the original bytes. (The
      // reader treats it as an empty timeline; only the append refuses.)
      if (shape.version !== undefined && shape.version !== EVENT_LOG_VERSION) {
        const found = typeof shape.version === 'number' || typeof shape.version === 'string' ? String(shape.version) : 'unknown'
        const kind = typeof shape.version === 'number' || typeof shape.version === 'string' ? typeof shape.version : 'unknown'
        // V4-48: a version written as the STRING "1" is statically unequal to
        // the number 1 and is refused, but the old message rendered both as
        // "found 1, expected 1" — type-ambiguous and self-contradictory. Report
        // the type so a manual-editer/heterogeneous writer sees the real cause.
        const rendered = kind === 'string' ? `"${found}"` : found
        refuseMessage = `evolution event log version mismatch (expected version ${EVENT_LOG_VERSION}, got ${rendered} (${kind})) and was not touched`
        return current
      }
    }
    const rotated = await rotateIfDue(io, path, v1EventRecords(parsedBody), rotateAt)
    if (!rotated.ok) {
      // P2-11: an unmergeable archive collision writes NOTHING — the active
      // keeps the full band and the append reports the refusal.
      refuseMessage = rotated.reason
      return current
    }
    const events = rotated.events
    // P2-1 (v11): a single rotate pass — the second call was either a no-op
    // (production threshold) or a double rotation (small test thresholds).
    // v23 (ML-3): seq continues from the max of BOTH the active file and the
    // archive names. The old `if (maxSeq === 0)` gate only consulted the
    // archives when the active was empty — an active ROLLED BACK to an older
    // backup (manual restore) kept a maxSeq below the archived range, so new
    // events reused archived seqs and the timeline merge's "active wins" rule
    // silently shadowed the archived records.
    let maxSeq = events.reduce((max, entry) => Math.max(max, entry.seq), 0)
    for (const name of await listEventArchives(io, path)) {
      maxSeq = Math.max(maxSeq, Number.parseInt(name.slice(EVENT_ARCHIVE_PREFIX.length, name.length - 5), 10))
    }
    const record: EvolutionEvent = { ...(event as Omit<EvolutionEvent, 'seq' | 'at'>), seq: maxSeq + 1, at: new Date().toISOString() }
    assigned = record.seq
    return JSON.stringify({ version: EVENT_LOG_VERSION, events: [...events, record] }, null, 2)
  })
  if (assigned === 0) {
    throw new Error(`${refuseMessage || 'evolution event log is malformed and was not touched'}: ${path}`)
  }
  return assigned
}

/** Rotation outcome: the next active body, or a refusal that aborts the append
 * without writing (P2-11: an archive collision this v1 writer cannot merge). */
type RotateOutcome = { ok: true; events: EvolutionEvent[] } | { ok: false; reason: string }

/** The collision archive is mergeable only when this v1 writer can read it
 * (P2-11): a foreign `version` (F-338) or a body without an `events` array is
 * refused, so a merge can never downgrade it or empty it out.
 * @param parsed - the parsed collision archive body.
 * @returns the usable events, or null when the archive must not be rewritten. */
function mergeableCollisionEvents(parsed: { version?: unknown; events?: unknown }): EvolutionEvent[] | null {
  if (parsed.version !== undefined && parsed.version !== EVENT_LOG_VERSION) return null
  if (!Array.isArray(parsed.events)) return null
  return parsed.events.filter(isEventRecord)
}

/**
 * Split the active log at its midpoint when due: the older half is written to
 * `events-<lastArchivedSeq>.json` (await — a failed archive write aborts the
 * append so the active is never truncated without its copy), old archives are
 * pruned, and the newer half is returned as the next active body. No-op when
 * under the threshold; `rotateAt < 2` is a guarded no-op (rc.72 G-1: a
 * one-event rotate would archive everything and restart seqs at 1).
 */
async function rotateIfDue(io: EvolutionIoLike, path: string, events: EvolutionEvent[], rotateAt: number): Promise<RotateOutcome> {
  // A2-10 (v18): a NaN rotateAt made both comparisons false, so the log
  // rotated on EVERY append. Treat non-finite as "no rotation".
  if (!Number.isFinite(rotateAt) || rotateAt < 2 || events.length < rotateAt) return { ok: true, events }
  const mid = Math.ceil(events.length / 2)
  const head = events.slice(0, mid)
  const tail = events.slice(mid)
  if (tail.length === 0) return { ok: true, events }
  const anchor = tail[0]?.seq ?? 0
  const archivePath = join(dirname(path), `${EVENT_ARCHIVE_PREFIX}${anchor - 1}.json`)
  // v31 EVENTS-01: after a manual active-file rollback the recomputed archive
  // name can COLLIDE with an existing archive holding a DIFFERENT seq band —
  // the old in-place write destroyed that band silently (feedback/learn/usage
  // history gone while every reader reported a coherent timeline). Merge the
  // two generations instead: both bands survive, overlapping seqs dedupe.
  let archived = head
  // C-events-dispatch-2 (v43 audit): only a readText of `null` means "that slot
  // is free" — the node backend maps just ENOENT/ENOTDIR to null and lets every
  // other failure (EACCES/EIO/EBUSY) propagate (io.ts readText contract). The
  // old `.catch(() => null)` folded such a failure into "nothing to collide
  // with", so the archive write below destroyed a band that WAS on disk. An
  // unreadable collision archive now refuses the rotation exactly like an
  // unmergeable one (P2-11): the active keeps its full band, the archive keeps
  // its bytes, and no band leaves the logical timeline.
  let existing: string | null
  try {
    existing = await io.readText(archivePath)
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `evolution event archive collision at ${archivePath} could not be read (${cause}) and was not touched` }
  }
  if (existing !== null) {
    let parsed: { version?: unknown; events?: unknown } | null = null
    try { parsed = JSON.parse(existing) as { version?: unknown; events?: unknown } } catch { parsed = null }
    if (parsed === null) {
      // An unparsable collision file must not be destroyed: shift this
      // rotation's head aside under a distinct name instead. v31 EVENTS-02:
      // the shift-aside is OBSERVABLE (the band leaves the logical timeline —
      // the collide name matches no archive reader) and PRUNABLE (the old
      // silent form accumulated without bound).
      const shiftPath = `${archivePath}.${Date.now()}.collide`
      await io.writeText(shiftPath, JSON.stringify({ version: EVENT_LOG_VERSION, events: head }, null, 2))
      console.warn(`evolution-events: rotation hit an unparsable archive collision — the rotated head band was preserved at ${shiftPath} but is OUTSIDE the logical timeline; inspect and merge it manually`)
      await retainEventArchives(io, path)
      await pruneCollideArchives(io, path)
      return { ok: true, events: tail }
    }
    const prior = mergeableCollisionEvents(parsed)
    if (prior === null) {
      // P2-11 (v37): merging REWRITES the collision archive, so an archive this
      // v1 writer cannot read must never be merged — a future version would be
      // downgraded (F-338) and a body without `events` was emptied and
      // destroyed. Refuse the rotation: the active keeps its full band, the
      // archive keeps its bytes, and no band leaves the logical timeline.
      return { ok: false, reason: `evolution event archive collision at ${archivePath} is not a readable version-${EVENT_LOG_VERSION} archive (future version, or no "events" array) and was not touched` }
    }
    // v33 F-3: the merge validates like every reader does - a collision
    // archive with damaged entries must not re-persist junk into the
    // canonical band (isEventRecord is the same filter the timeline uses).
    const bySeq = new Map(prior.map(event => [event.seq, event]))
    for (const event of head) bySeq.set(event.seq, event)
    archived = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  }
  await io.writeText(archivePath, JSON.stringify({ version: EVENT_LOG_VERSION, events: archived }, null, 2))
  await retainEventArchives(io, path)
  return { ok: true, events: tail }
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

/** v31 EVENTS-02: prune shift-aside collision files (`events-*.json.<ts>.collide`)
 * after the same 7-day window the `.corrupt` sweep uses. They are write-once
 * recovery artifacts no reader accepts; without a sweep they accumulated
 * without bound across rollback episodes. No mtime probe → keep (fail-safe). */
const COLLIDE_AGE_MS = 7 * 24 * 60 * 60 * 1000

async function pruneCollideArchives(io: EvolutionIoLike, path: string): Promise<void> {
  const dir = dirname(path)
  let names: string[]
  try {
    names = await io.list(dir)
  } catch {
    return
  }
  const now = Date.now()
  for (const name of names) {
    if (!name.endsWith('.collide') || !name.startsWith('events-')) continue
    const full = join(dir, name)
    const stamp = name.match(/\.(\d{13})\.collide$/)
    if (stamp && now - Number(stamp[1]) < COLLIDE_AGE_MS) continue
    if (!stamp) {
      // v33 F-2: the no-stamp branch is FAIL-SAFE BY CONTRACT - an unknown
      // collision artifact (no readable mtime, absent mtime probe) is KEPT,
      // never destroyed. A rejecting mtime is contained here so housekeeping
      // cannot abort the event append.
      try {
        const mtime = await io.mtime?.(full)
        // C-events-dispatch-3 (v43 audit): only a NUMBER that is old enough may
        // be deleted. `undefined` (a backend that omits the probe), `null` (a
        // probe that cannot tell, io.ts) and a rejecting probe all mean "age
        // unknown" and KEEP the artifact, exactly as the contract above states —
        // the old branch fell through to `remove` on all three.
        if (typeof mtime !== 'number' || now - mtime < COLLIDE_AGE_MS) continue
      } catch {
        continue
      }
    }
    await io.remove(full).catch(() => {})
  }
}

interface EventLogRead {
  events: EvolutionEvent[]
  /** True when THIS read DROPPED events the file may hold, so the result must
   * never be treated as the complete truth for that file. Three causes flag it:
   * syntax-level damage and a READ error (EISDIR/EACCES) — both refused on
   * append with their bytes untouched — and, since C-events-dispatch-1 (v43
   * audit), a body whose `version` this reader cannot interpret: F-338 keeps
   * such a body un-reshaped and never rewritten down, but its records ARE
   * missing from the read. A well-formed body with a damaged `events` field
   * stays UNflagged — REPLACEABLE garbage that reads as empty and is rewritten
   * at the next append (rc.70 F-1: read and append agree on the same boundary). */
  malformed: boolean
}

/** Read the event log; a missing/whitespace-only file reads as empty, corrupt
 * content is flagged (and refused on append). A well-formed future-version body
 * is v1-incompatible: it reads as EMPTY and is now flagged malformed as well
 * (C-events-dispatch-1, v43). F-338's own guarantees are untouched — the reader
 * never mis-shapes a newer format and the append path refuses it up front, so
 * the original bytes survive — while the flag reports what the old reader hid:
 * every record that body holds is dropped from this read. */
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
    // must not be shaped as v1. It still reads as empty (the append path
    // rejects it before writing, so nothing is overwritten) but it is FLAGGED:
    // the band that body holds leaves the timeline HERE, and a consumer that
    // cannot see the drop folds a truncated history as if it were the truth
    // (C-events-dispatch-1, v43 audit).
    if (parsed.version !== undefined && parsed.version !== EVENT_LOG_VERSION) return { events: [], malformed: true }
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
 * flagged ARCHIVE (unreadable, damaged, or a future-version body this reader
 * cannot interpret) is SKIPPED — it never bricks the boot, the returned events
 * simply LACK that seq band, and `malformed` is the only signal that they do
 * (C-events-dispatch-1, v43: the flag is the consumer's contract; a truncated
 * timeline must never be folded back as if it were complete).
 */
export async function readEvolutionTimeline(
  io: EvolutionIoLike,
  path: string,
  archives?: readonly string[],
): Promise<EventLogRead> {
  const dir = dirname(path)
  let malformed = false
  const bySeq = new Map<number, EvolutionEvent>()
  // C2 (v35): a caller that already listed the archives (the boot restore does)
  // passes them in instead of paying a second directory scan.
  for (const name of archives ?? await listEventArchives(io, path)) {
    const read = await readEvolutionEvents(io, join(dir, name))
    if (read.malformed) malformed = true
    for (const event of read.events) bySeq.set(event.seq, event)
  }
  const active = await readEvolutionEvents(io, path)
  if (active.malformed) malformed = true
  for (const event of active.events) bySeq.set(event.seq, event)
  return { events: [...bySeq.values()].sort((a, b) => a.seq - b.seq), malformed }
}
