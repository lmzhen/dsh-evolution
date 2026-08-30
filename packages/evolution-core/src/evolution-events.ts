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
import { join } from 'node:path'

export const EVENT_LOG_VERSION = 1

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
 */
export async function appendEvolutionEvent(io: EvolutionIoLike, path: string, event: Omit<EvolutionEvent, 'seq' | 'at'>): Promise<number> {
  let assigned = 0
  await transactIo(io, path, (current) => {
    // rc.69: a whitespace-only log (crash residue) is rebuildable — treat it
    // as missing; a genuinely corrupt body is still refused.
    if (current !== null && current.trim() !== '') {
      try { JSON.parse(current) } catch { return Promise.resolve(current) }
    }
    const events = parseEvolutionEvents(current)
    const maxSeq = events.reduce((max, entry) => Math.max(max, entry.seq), 0)
    const record: EvolutionEvent = { ...event, seq: maxSeq + 1, at: new Date().toISOString() }
    assigned = record.seq
    return Promise.resolve(JSON.stringify({ version: EVENT_LOG_VERSION, events: [...events, record] }, null, 2))
  })
  if (assigned === 0) throw new Error(`evolution event log is malformed and was not touched: ${path}`)
  return assigned
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
