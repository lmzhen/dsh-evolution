/**
 * Feedback-to-quality scoring for self-evolution.
 *
 * Feedback is durable through `ctx.evolutionIo` (when mounted) and skill
 * feedback feeds `quality_score` / `quality_warn` on the usage record, so
 * curator decisions can consume it deterministically.
 * @module @deepseek-ai/dsh-evolution-feedback
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import type {} from '@deepseek-ai/dsh-skill-usage'
import { evolutionIoAdapter, transactIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
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

export class EvolutionFeedback {
  private state: FeedbackState = { skills: {}, sessions: {} }
  private chain: Promise<unknown> = Promise.resolve()
  private readonly path?: string

  constructor(io?: IoLike, home = process.env.DSH_HOME ?? join(homedir(), '.dsh'), pathOverride?: string) {
    if (io) this.path = pathOverride ?? join(home, 'evolution', 'feedback.json')
  }

  private mutate<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  async restore(io: IoLike): Promise<void> {
    const path = this.path
    if (!path) return
    await this.mutate(async () => {
      const raw = await io.readText(path)
      if (raw === null) return
      try {
        const parsed = JSON.parse(raw) as Partial<FeedbackState>
        // MERGE instead of replace: records written before the (background)
        // restore settled must not be clobbered by a stale disk snapshot.
        this.state = {
          skills: { ...parsed.skills, ...this.state.skills },
          sessions: { ...parsed.sessions, ...this.state.sessions },
        }
      } catch {
        // Malformed feedback is non-fatal; start with an empty state.
      }
    })
  }

  record(target: string, rating: 'positive' | 'negative', note?: string, kind: 'skill' | 'session' = 'session', io?: IoLike): void {
    const table = kind === 'skill' ? this.state.skills : this.state.sessions
    const current = table[target] ?? { positive: 0, negative: 0 }
    current[rating] += 1
    if (note !== undefined) current.lastNote = note
    table[target] = current
    if (io && this.path) void this.flush(io)
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

  async flush(io?: IoLike): Promise<void> {
    const path = this.path
    if (!path || !io) return
    await this.mutate(async () => {
      // Sidecar transaction (P1-③): the flush merges with whatever another
      // process persisted — a full overwrite would drop another process's
      // records (same interleave class as activity before rc.58).
      await transactIo(io, path, (current) => {
        const merged = mergeStates(parseState(current), this.state)
        this.state = merged
        return Promise.resolve(JSON.stringify(merged, null, 2))
      })
    })
  }
}

/** Parse a raw feedback sidecar; malformed reads as empty (best-effort). */
function parseState(raw: string | null): FeedbackState {
  if (raw === null) return { skills: {}, sessions: {} }
  try {
    const parsed = JSON.parse(raw) as Partial<FeedbackState>
    return {
      skills: typeof parsed.skills === 'object' && !Array.isArray(parsed.skills) ? parsed.skills : {},
      sessions: typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions) ? parsed.sessions : {},
    }
  } catch {
    return { skills: {}, sessions: {} }
  }
}

/** Deep-merge two feedback states: union by target, in-memory values win on conflict. */
function mergeStates(disk: FeedbackState, memory: FeedbackState): FeedbackState {
  return {
    skills: { ...disk.skills, ...memory.skills },
    sessions: { ...disk.sessions, ...memory.sessions },
  }
}

export const name = 'evolution-feedback'

export interface Config {
  /** Score below which curator receives quality_warn for a skill. */
  qualityWarnThreshold?: number
  /** Explicit feedback file path; empty derives $DSH_HOME/evolution/feedback.json. */
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
  // Lazy adapter: forwards transact (P1-③) so flush merges with the disk
  // state instead of overwriting another process's records.
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
    feedback.record = (target, rating, note, kind, recordIo) => {
      original(target, rating, note, kind ?? 'session', recordIo ?? io)
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
    // Return the flush promise so cordis awaits it during plugin unload
    // (rc.50 P2-12): a fire-and-forget flush could lose the last records when
    // the fiber tears down right after a record().
    if (io) return feedback.flush(io)
  }, 'evolution-feedback.flush')
}
