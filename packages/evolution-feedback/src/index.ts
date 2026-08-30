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
import { appendEvolutionEvent, eventsFile, evolutionIoAdapter, readEvolutionEvents, transactIo, EVENT_LOG_VERSION, type EvolutionEvent, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { homedir } from 'node:os'
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

export class EvolutionFeedback {
  private state: FeedbackState = { skills: {}, sessions: {} }
  private chain: Promise<unknown> = Promise.resolve()
  private readonly path?: string
  private readonly eventsPath?: string
  private readonly io: IoLike | undefined

  constructor(io?: IoLike, home = process.env.DSH_HOME ?? join(homedir(), '.dsh'), pathOverride?: string) {
    if (io) {
      // rc.68 + K-6: BOTH paths derive from the constructor surface only —
      // record() takes no backend io, so path and io backend can never disagree.
      this.path = pathOverride ?? join(home, 'evolution', 'feedback.json')
      this.eventsPath = eventsFile(home)
    }
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
      // Migration (rc.68, idempotent): no event log yet — fold whatever
      // aggregate exists (legacy v1 or a v2 cache) into synthetic events so
      // history starts from the old truth once. The first process to win the
      // transact creates the log; a later boot sees it and skips migration.
      if (rawEvents === null) {
        const aggregate = parseAggregate(await io.readText(path))
        if (aggregate) {
          try {
            await transactIo(io, eventsPath, (current) => {
              if (current !== null) return Promise.resolve(current)
              return Promise.resolve(JSON.stringify({ version: EVENT_LOG_VERSION, events: synthesizeFeedbackEvents(aggregate) }, null, 2))
            })
          } catch {
            // Best-effort: a failed migration means the log stays absent and
            // history starts empty — the old aggregate is not re-booted.
          }
        }
      }
      const { events } = await readEvolutionEvents(io, eventsPath)
      const cache = parseCache(await io.readText(path))
      const maxSeq = events.reduce((max, event) => Math.max(max, event.seq), 0)
      const truth = cache ? foldWithDelta(cache, events) : foldFeedbackState(events)
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
    current[rating] += 1
    if (note !== undefined) current.lastNote = note
    table[target] = current
    const recordIo = this.io
    const eventsPath = this.eventsPath
    if (!recordIo || !eventsPath) return
    // rc.68: the increment is an EVENT APPEND under the write lock — the log
    // is the truth, the aggregate is derived. A malformed log refuses the
    // append (rc.65 posture) and the optimistic count stays.
    void this.mutate(async () => {
      try {
        await appendEvolutionEvent(recordIo, eventsPath, { type: 'feedback', target, kind, rating, note })
      } catch (error: unknown) {
        // Best-effort: the optimistic count stays (recoverable on the next
        // successful record); a persistence failure must not throw.
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

  /** Rebuild the boot cache from the log truth (rc.68); best-effort. */
  persistCache(): Promise<void> {
    const path = this.path
    const eventsPath = this.eventsPath
    const recordIo = this.io
    if (!path || !eventsPath || !recordIo) return Promise.resolve()
    return this.mutate(async () => {
      try {
        const { events } = await readEvolutionEvents(recordIo, eventsPath)
        const maxSeq = events.reduce((max, event) => Math.max(max, event.seq), 0)
        if (maxSeq === 0) return
        await recordIo.writeText(path, JSON.stringify({ version: CACHE_VERSION, lastSeq: maxSeq, ...foldFeedbackState(events) }, null, 2))
      } catch {
        // Best-effort: the cache is disposable.
      }
    })
  }
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

function parseCache(raw: string | null): { lastSeq: number; state: FeedbackState } | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; lastSeq?: unknown; skills?: unknown; sessions?: unknown }
    if (parsed.version !== CACHE_VERSION || typeof parsed.lastSeq !== 'number') return null
    if (!isRecord(parsed.skills) || !isRecord(parsed.sessions)) return null
    return {
      lastSeq: parsed.lastSeq,
      state: { skills: parsed.skills as FeedbackState['skills'], sessions: parsed.sessions as FeedbackState['sessions'] },
    }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Fold all feedback events from zero (the truth view). */
function foldFeedbackState(events: EvolutionEvent[]): FeedbackState {
  const state: FeedbackState = { skills: {}, sessions: {} }
  for (const event of events) applyFeedbackEvent(state, event)
  return state
}

/** Fold events after the cache's lastSeq onto the cached aggregates. */
function foldWithDelta(cache: { lastSeq: number; state: FeedbackState }, events: EvolutionEvent[]): FeedbackState {
  const state: FeedbackState = {
    skills: { ...cache.state.skills },
    sessions: { ...cache.state.sessions },
  }
  for (const event of events) {
    if (event.seq > cache.lastSeq) applyFeedbackEvent(state, event)
  }
  return state
}

function applyFeedbackEvent(state: FeedbackState, event: EvolutionEvent): void {
  if (event.type !== 'feedback') return
  const target = event.target
  if (target === undefined || event.rating === undefined) return
  const table = event.kind === 'skill' ? state.skills : state.sessions
  const record = table[target] ?? { positive: 0, negative: 0 }
  record[event.rating] += 1
  if (event.note !== undefined) record.lastNote = event.note
  table[target] = record
}

/** Synthesize one event per aggregate count unit, lastNote on the final event (migration). */
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
    if (record.lastNote !== undefined && events.length >= first) {
      const last = events.length - 1
      const final = events[last]
      if (final) events[last] = { ...final, note: record.lastNote }
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
  /** Explicit boot-cache file path; empty derives $DSH_HOME/evolution/feedback.json
   * (the event log is its sibling `events.json`). */
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
  const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
  const io = ioRegistry ? evolutionIoAdapter(() => ioRegistry.provider()) : undefined
  const feedback = new EvolutionFeedback(io, process.env.DSH_HOME ?? join(homedir(), '.dsh'), rawConfig.path || undefined)
  if (io) {
    void feedback.restore(io).catch((error: unknown) => {
      ctx.logger.warn(error)
    })
  }

  // Make the service available first; restoration settles in the background.
  ctx.provide('evolutionFeedback', feedback)

  const skillUsage = ctx.get('skillUsage') as SkillUsageLike | undefined
  if (skillUsage) {
    const original = feedback.record.bind(feedback)
    feedback.record = (target, rating, note, kind) => {
      original(target, rating, note, kind ?? 'session')
      if (kind === 'skill') {
        const score = feedback.score(target, 'skill')
        const warn = score < (rawConfig.qualityWarnThreshold ?? -0.25)
        void skillUsage.setQuality(target, score, warn).catch((error: unknown) => {
          ctx.logger.warn(error)
        })
      }
    }
  }

  ctx.effect(() => () => {
    // rc.68: the event log is the only durable write, but the boot cache is
    // refreshed from the log truth at unload — plus the rc.66 waitIdle for
    // pending appends so a slow CI cannot remove a file mid-write.
    return Promise.all([feedback.persistCache(), feedback.waitIdle()])
  }, 'evolution-feedback.records')
}
