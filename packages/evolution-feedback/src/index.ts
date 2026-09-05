/**
 * Feedback-to-quality scoring for self-evolution.
 *
 * Feedback is durable through `ctx.evolutionIo` (when mounted) and skill
 * feedback feeds `quality_score` / `quality_warn` on the usage record, so
 * curator decisions can consume it deterministically.
 *
 * Persistence (rc.68): the EVENTS LOG (`evolution/events.json`, via
 * `evolution-core/evolution-events.ts`) is the single source of truth —
 * every increment appends one event under the write lock. `feedback.json` is
 * a rebuildable BOOT CACHE (`{ version: 2, lastSeq, skills, sessions }`),
 * never the truth; the in-memory state is the optimistic aggregate.
 * @module @deepseek-ai/dsh-evolution-feedback
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import type {} from '@deepseek-ai/dsh-skill-usage'
import { appendEvolutionEvent, eventsFile, evolutionIoAdapter, evolutionRoot, listEventArchives, parseEvolutionEvents, readEvolutionTimeline, transactIo, EVENT_LOG_VERSION, type EvolutionEvent, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { join } from 'node:path'

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionFeedback: EvolutionFeedback
  }
}

export interface FeedbackRecord {
  positive: number
  negative: number
  lastNote?: string | undefined
}

export interface FeedbackState {
  skills: Record<string, FeedbackRecord>
  sessions: Record<string, FeedbackRecord>
}

type IoLike = EvolutionIoLike

const CACHE_VERSION = 2

/** Cache snapshot cadence (rc.72 G-3): every N-th appended event refreshes the
 * boot cache, so `cache.lastSeq` always stays inside the retention window —
 * a hard crash between snapshots loses at most N events, all of which still
 * live in the ACTIVE log (bounded by `EVENT_LOG_ROTATE_AT`), so the next fold
 * is complete. Package-private tunable, not a config surface. */
const CACHE_SNAP_EVERY = 1024

export class EvolutionFeedback {
  private state: FeedbackState = { skills: {}, sessions: {} }
  private chain: Promise<unknown> = Promise.resolve()
  private readonly path?: string
  private readonly eventsPath?: string
  private io: IoLike | undefined
  private warn: (message: string) => void

  constructor(io?: IoLike, home = evolutionRoot(), pathOverride?: string, warn: (message: string) => void = () => {}) {
    // rc.68 + K-6: BOTH paths derive from the constructor surface only —
    // record() takes no backend io, so path and io backend can never disagree.
    // They derive unconditionally so a late `attachIo` (S6.4) does not need to
    // repopulate them; methods no-op on `this.io` being absent.
    this.path = pathOverride ?? join(home, 'evolution', 'feedback.json')
    this.eventsPath = eventsFile(home)
    this.io = io
    this.warn = warn
  }

  /** Bind the evolution IO backend after construction (S6.4 deferred binding). */
  attachIo(io: IoLike): void {
    this.io = io
  }

  private mutate<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  async restore(io: IoLike): Promise<void> {
    const path = this.path
    const eventsPath = this.eventsPath
    if (!path || !eventsPath) return
    await this.mutate(async () => {
      const rawEvents = await io.readText(eventsPath)
      // Migration (rc.68/rc.69, idempotent + race-safe): no event log AND no
      // archive yet — fold whatever aggregate exists (legacy v1 or v2 cache)
      // into synthetic events. rc.71: with archives present the truth lives in
      // the archive timeline, so a manually deleted active file must never be
      // re-synthesized from the cache. rc.69: a concurrent first writer that
      // created the log in the race window is handled by the merge in
      // migrateFeedbackEvents (append, never drop).
      const archiveNames = await listEventArchives(io, eventsPath)
      const noLog = rawEvents === null || rawEvents.trim() === ''
      if (noLog && archiveNames.length === 0) {
        const aggregate = parseAggregate(await io.readText(path))
        if (aggregate) {
          try {
            await migrateFeedbackEvents(io, eventsPath, aggregate)
          } catch {
            // Best-effort: a failed migration means the log stays absent and
            // history starts empty — the old aggregate is not re-booted.
          }
        }
      }
      const { events } = await readEvolutionTimeline(io, eventsPath)
      const cache = parseCache(await io.readText(path), this.warn)
      const maxSeq = events.reduce((max, event) => Math.max(max, event.seq), 0)
      const floor = events[0]?.seq ?? 0
      // rc.72 G-3: a cache whose lastSeq fell below the timeline floor is out
      // of the retained window — using it would silently fabricate a partial
      // fold; fall back to the full fold (an unrecoverable band stays lost,
      // but the result is never WRONG).
      const usableCache = cache && cache.lastSeq >= floor - 1 ? cache : null
      const truth = usableCache ? foldWithDelta(usableCache, events, this.warn) : foldFeedbackState(events, this.warn)
      // Memory wins per record (rc.66 semantics): a record() that landed
      // optimistically before this restore settled must survive.
      this.state = {
        skills: { ...truth.skills, ...this.state.skills },
        sessions: { ...truth.sessions, ...this.state.sessions },
      }
      // Refresh the boot cache from the TRUTH, never from the memory-merged
      // state — an optimistic record whose event is not yet on disk must not
      // double-count at the next boot.
      if (maxSeq > 0 && (!cache || cache.lastSeq < maxSeq)) {
        try {
          await io.writeText(path, JSON.stringify({ version: CACHE_VERSION, lastSeq: maxSeq, ...truth }, null, 2))
        } catch {
          // Best-effort: the cache is disposable.
        }
      }
    })
  }

  record(target: string, rating: 'positive' | 'negative', note?: string, kind: 'skill' | 'session' = 'session'): void {
    const mode = kind === 'skill' ? 'skills' : 'sessions'
    // Optimistic in-memory update: score()/quality read it synchronously.
    const table = this.state[mode]
    const current = table[target] ?? { positive: 0, negative: 0 }
    const previousNote = current.lastNote
    current[rating] += 1
    if (note !== undefined) current.lastNote = note
    table[target] = current
    const recordIo = this.io
    const eventsPath = this.eventsPath
    if (!recordIo || !eventsPath) return
    // rc.68: the increment is an EVENT APPEND under the write lock — the log
    // is the truth, the aggregate is derived. A malformed log refuses the
    // append (rc.65 posture). S6.4 E-8: a failed append reclaims the optimistic
    // count — the log is the truth, so a count that never landed must not
    // linger in memory (it would silently diverge and be dropped next boot).
    void this.mutate(async () => {
      try {
        const seq = await appendEvolutionEvent(recordIo, eventsPath, { type: 'feedback', target, kind, rating, note })
        // rc.72 G-3: cadence snapshot keeps the boot cache inside the retention
        // window (see CACHE_SNAP_EVERY); best-effort inside the same task.
        // writeCacheNow swallows its own errors and never throws, so this catch
        // is reached only when the append itself failed.
        if (seq % CACHE_SNAP_EVERY === 0) await this.writeCacheNow()
      } catch (error: unknown) {
        const rollback = table[target]
        if (rollback) {
          rollback[rating] -= 1
          if (note !== undefined) {
            if (previousNote === undefined) delete rollback.lastNote
            else rollback.lastNote = previousNote
          }
        }
        // Best-effort: the rollback keeps memory aligned with the log truth; a
        // persistence failure must not throw.
        void error
      }
    })
  }

  score(target: string, kind: 'skill' | 'session' = 'session'): number {
    const table = kind === 'skill' ? this.state.skills : this.state.sessions
    const record = table[target]
    if (!record) return 0
    const total = record.positive + record.negative
    if (total === 0) return 0
    return (record.positive - record.negative) / total
  }

  snapshot(): FeedbackState {
    return {
      skills: { ...this.state.skills },
      sessions: { ...this.state.sessions },
    }
  }

  /** Await the pending record-task chain (unload safety; rc.66). */
  waitIdle(): Promise<unknown> {
    return this.chain
  }

  /** Snapshot the boot cache from the log truth (rc.68/rc.72); best-effort. */
  private async writeCacheNow(): Promise<void> {
    const path = this.path
    const eventsPath = this.eventsPath
    const recordIo = this.io
    if (!path || !eventsPath || !recordIo) return
    try {
      const { events } = await readEvolutionTimeline(recordIo, eventsPath)
      const maxSeq = events.reduce((max, event) => Math.max(max, event.seq), 0)
      if (maxSeq === 0) return
      const body = JSON.stringify({ version: CACHE_VERSION, lastSeq: maxSeq, ...foldFeedbackState(events, this.warn) }, null, 2)
      await recordIo.writeText(path, body)
    } catch {
      // Best-effort: the cache is disposable.
    }
  }

  /** Rebuild the boot cache from the log truth (rc.68); best-effort, queued
   * on the record chain so it runs after the pending appends. */
  persistCache(): Promise<void> {
    return this.mutate(async () => {
      await this.writeCacheNow()
    })
  }
}

/** True when `existing` contains the legacy sequence as a contiguous run on
 * its semantic fields (skip case). `seq` and `at` are excluded: after a merge
 * the legacy events carry shifted seqs, and a re-synthesis stamps a different
 * `at` — the semantic identity is type/kind/target/rating/note. A coincidental
 * semantic match of an already-appended user sequence yields the identical
 * aggregation, so the skip is harmless for counts and notes. */
function containsLegacySequence(existing: EvolutionEvent[], expected: EvolutionEvent[]): boolean {
  if (expected.length === 0) return true
  for (let start = 0; start <= existing.length - expected.length; start += 1) {
    let match = true
    for (let offset = 0; offset < expected.length; offset += 1) {
      const a = expected[offset]
      const b = existing[start + offset]
      if (!a || !b || a.type !== b.type || a.kind !== b.kind || a.target !== b.target || a.rating !== b.rating || a.note !== b.note) {
        match = false
        break
      }
    }
    if (match) return true
  }
  return false
}

/**
 * Merge a legacy aggregate into the event log (rc.69): the expected synthetic
 * sequence is APPENDED (seq-shifted) when the log does not already contain it
 * — so a concurrent first writer's events AND the legacy history both
 * survive; when the sequence is already present the migration was completed
 * (by a first writer or by this path) and nothing is re-appended. Idempotent
 * and race-safe (the search runs inside the same transact). Exported for the
 * migration-race regression test.
 */
export async function migrateFeedbackEvents(io: IoLike, eventsPath: string, aggregate: FeedbackState): Promise<void> {
  const expected = synthesizeFeedbackEvents(aggregate)
  await transactIo(io, eventsPath, (current) => {
    const existing = parseEvolutionEvents(current)
    // Skip = hand back `current` untouched: null means "no file" in the
    // transact contract, so an empty legacy aggregate never creates one
    // (rc.70 F-4).
    if (containsLegacySequence(existing, expected)) return Promise.resolve(current)
    const maxSeq = existing.reduce((max, event) => Math.max(max, event.seq), 0)
    const merged = [...existing, ...expected.map((event, index) => ({ ...event, seq: maxSeq + index + 1 }))]
    return Promise.resolve(JSON.stringify({ version: EVENT_LOG_VERSION, events: merged }, null, 2))
  })
}

/** Parse a legacy aggregate (v1) or a v2 cache into a plain aggregate state. */
function parseAggregate(raw: string | null): FeedbackState | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<{ skills?: unknown; sessions?: unknown }>
    const skills = isRecord(parsed.skills) ? parsed.skills as FeedbackState['skills'] : undefined
    const sessions = isRecord(parsed.sessions) ? parsed.sessions as FeedbackState['sessions'] : undefined
    if (!skills && !sessions) return null
    return { skills: skills ?? {}, sessions: sessions ?? {} }
  } catch {
    return null
  }
}

function parseCache(raw: string | null, warn: (message: string) => void = () => {}): { lastSeq: number; state: FeedbackState } | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; lastSeq?: unknown; skills?: unknown; sessions?: unknown }
    if (parsed.version !== CACHE_VERSION || typeof parsed.lastSeq !== 'number' || !Number.isFinite(parsed.lastSeq)) return null
    if (!isRecord(parsed.skills) || !isRecord(parsed.sessions)) return null
    return {
      lastSeq: parsed.lastSeq,
      state: {
        skills: sanitizeCacheRecords(parsed.skills, 'skill', warn),
        sessions: sanitizeCacheRecords(parsed.sessions, 'session', warn),
      },
    }
  } catch {
    return null
  }
}

/** Per-record numeric-domain validation (S6.4): a record whose `positive` or
 * `negative` is not a finite number >= 0, or whose `lastNote` is not a string,
 * would fold as NaN into the usage aggregate — skip it with a warn instead of
 * corrupting the state. A record with no valid count is dropped entirely. */
function sanitizeCacheRecords(input: Record<string, unknown>, kind: 'skill' | 'session', warn: (message: string) => void): Record<string, FeedbackRecord> {
  const out: Record<string, FeedbackRecord> = {}
  for (const [target, value] of Object.entries(input)) {
    const record = sanitizeFeedbackRecord(value, target, kind, warn)
    if (record) out[target] = record
  }
  return out
}

function sanitizeFeedbackRecord(value: unknown, target: string, kind: 'skill' | 'session', warn: (message: string) => void): FeedbackRecord | null {
  if (!isRecord(value)) {
    warn(`evolution-feedback: skipping cache record for ${kind} "${target}": not a record`)
    return null
  }
  const positive = value.positive
  const negative = value.negative
  const note = value.lastNote
  const validCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  if (!validCount(positive) || !validCount(negative)) {
    warn(`evolution-feedback: skipping cache record for ${kind} "${target}": positive/negative must be finite numbers >= 0`)
    return null
  }
  if (note !== undefined && typeof note !== 'string') {
    warn(`evolution-feedback: skipping cache record for ${kind} "${target}": lastNote must be a string`)
    return null
  }
  return { positive, negative, ...(note !== undefined ? { lastNote: note } : {}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Fold all feedback events from zero (the truth view). */
function foldFeedbackState(events: EvolutionEvent[], warn: (message: string) => void = () => {}): FeedbackState {
  const state: FeedbackState = { skills: {}, sessions: {} }
  for (const event of events) applyFeedbackEvent(state, event, warn)
  return state
}

/** Fold events after the cache's lastSeq onto the cached aggregates. */
function foldWithDelta(
  cache: { lastSeq: number; state: FeedbackState },
  events: EvolutionEvent[],
  warn: (message: string) => void = () => {},
): FeedbackState {
  const state: FeedbackState = {
    skills: { ...cache.state.skills },
    sessions: { ...cache.state.sessions },
  }
  for (const event of events) {
    if (event.seq > cache.lastSeq) applyFeedbackEvent(state, event, warn)
  }
  return state
}

function applyFeedbackEvent(state: FeedbackState, event: EvolutionEvent, warn: (message: string) => void = () => {}): void {
  if (event.type !== 'feedback') return
  // S6.4: only 'positive'/'negative' are valid ratings. Any other value
  // (NaN or an arbitrary string from a malformed log) would fold
  // `record[value] += 1` as NaN into the usage aggregate, so skip with a warn.
  if (event.rating !== 'positive' && event.rating !== 'negative') {
    warn(`evolution-feedback: skipping feedback event with invalid rating: ${String(event.rating)}`)
    return
  }
  const target = event.target
  if (target === undefined) return
  const table = event.kind === 'skill' ? state.skills : state.sessions
  const record = table[target] ?? { positive: 0, negative: 0 }
  record[event.rating] += 1
  if (event.note !== undefined) record.lastNote = event.note
  table[target] = record
}

/** Synthesize one event per aggregate count unit, lastNote on the final event
 * (migration). A zero-count record still carrying a lastNote would otherwise
 * drop the note — emit a dedicated note event (S6.4) so it survives. */
function synthesizeFeedbackEvents(aggregate: FeedbackState): EvolutionEvent[] {
  const events: EvolutionEvent[] = []
  const at = new Date().toISOString()
  const emitTarget = (kind: 'skill' | 'session', target: string, record: FeedbackRecord): void => {
    const first = events.length + 1
    for (let index = 0; index < record.positive; index += 1) {
      events.push({ seq: events.length + 1, at, type: 'feedback', kind, target, rating: 'positive' })
    }
    for (let index = 0; index < record.negative; index += 1) {
      events.push({ seq: events.length + 1, at, type: 'feedback', kind, target, rating: 'negative' })
    }
    if (record.lastNote !== undefined) {
      if (events.length >= first) {
        const last = events.length - 1
        const final = events[last]
        if (final) events[last] = { ...final, note: record.lastNote }
      } else {
        // Zero-count record with a note: the event model only folds notes via a
        // rated feedback event, so preserve the note as a single positive event
        // (the record had no count to attach it to; the note is not lost).
        events.push({ seq: events.length + 1, at, type: 'feedback', kind, target, rating: 'positive', note: record.lastNote })
      }
    }
  }
  for (const [target, record] of Object.entries(aggregate.skills)) emitTarget('skill', target, record)
  for (const [target, record] of Object.entries(aggregate.sessions)) emitTarget('session', target, record)
  return events
}

export const name = 'evolution-feedback'

export interface Config {
  /** Score below which curator receives quality_warn for a skill. */
  qualityWarnThreshold?: number
  /** Explicit boot-cache file path; empty derives $DSH_HOME/evolution/feedback.json.
   * The event log always stays at $DSH_HOME/evolution/events.json (derived from
   * home, never from this override). */
  path?: string
}

export const Config: z<Config> = z.object({
  qualityWarnThreshold: z.number().default(-0.25),
  path: z.string().default(''),
})

interface SkillUsageLike {
  setQuality(name: string, score: number, warn: boolean): Promise<void>
}

export function apply(ctx: Context, rawConfig: Config = {}): void {
  // Deferred binding (S6.4, tool-* pattern): the feedback service is provided
  // with no backend first; evolutionIo/skillUsage wire themselves once the
  // providers mount. Apply-time `ctx.get` probes were startup-order sensitive —
  // a provider registered after this plugin was skipped entirely.
  const feedback = new EvolutionFeedback(
    undefined,
    evolutionRoot(),
    rawConfig.path || undefined,
    (message) => {
      ctx.logger.warn(message)
    },
  )
  // Make the service available first; restoration settles in the background.
  ctx.provide('evolutionFeedback', feedback)

  ctx.inject(['evolutionIo'], (ioCtx) => {
    const ioRegistry = (ioCtx as unknown as { evolutionIo: { provider(): EvolutionIoLike } }).evolutionIo
    const io = evolutionIoAdapter(() => ioRegistry.provider())
    feedback.attachIo(io)
    void feedback.restore(io).catch((error: unknown) => {
      ioCtx.logger.warn(error)
    })
  })

  const baseRecord = feedback.record.bind(feedback)
  let qualityWired = false
  ctx.inject(['skillUsage'], (skillCtx) => {
    if (qualityWired) return
    qualityWired = true
    const skillUsage = (skillCtx as unknown as { skillUsage: SkillUsageLike }).skillUsage
    feedback.record = (target, rating, note, kind) => {
      baseRecord(target, rating, note, kind ?? 'session')
      if (kind === 'skill') {
        const score = feedback.score(target, 'skill')
        const warn = score < (rawConfig.qualityWarnThreshold ?? -0.25)
        void skillUsage.setQuality(target, score, warn).catch((error: unknown) => {
          skillCtx.logger.warn(error)
        })
      }
    }
  })

  ctx.effect(() => () => {
    // rc.68: the event log is the only durable write, but the boot cache is
    // refreshed from the log truth at unload — plus the rc.66 waitIdle for
    // pending appends so a slow CI cannot remove a file mid-write.
    return Promise.all([feedback.persistCache(), feedback.waitIdle()])
  }, 'evolution-feedback.records')
}
