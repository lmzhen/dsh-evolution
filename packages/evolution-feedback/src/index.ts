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
  private readonly io: IoLike | undefined

  constructor(io?: IoLike, home = process.env.DSH_HOME ?? join(homedir(), '.dsh'), pathOverride?: string) {
    if (io) this.path = pathOverride ?? join(home, 'evolution', 'feedback.json')
    this.io = io
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
        // MERGE disk into memory, memory wins (rc.66): a record() that landed
        // before the restore settled must survive — the disk is the older
        // view, the optimistic in-memory count the newer one.
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
    const mode = kind === 'skill' ? 'skills' : 'sessions'
    // Optimistic in-memory update: score()/quality read it synchronously.
    const table = this.state[mode]
    const current = table[target] ?? { positive: 0, negative: 0 }
    current[rating] += 1
    if (note !== undefined) current.lastNote = note
    table[target] = current
    const recordIo = io ?? this.io
    const path = this.path
    if (!recordIo || !path) return
    // rc.66 (v3-audit P3-①): the count increment lands INSIDE the transact —
    // the same locked RMW pattern as memory/activity/state-json, so two
    // processes recording the same target can no longer lose an increment.
    // The snapshot settles to the on-disk truth after the write.
    void this.mutate(async () => {
      try {
        await transactIo(recordIo, path, (raw) => {
          // Malformed sidecars are never overwritten (rc.65 protection).
          if (raw !== null) {
            try { JSON.parse(raw) } catch { return Promise.resolve(raw) }
          }
          const diskState = parseState(raw)
          const diskTable = diskState[mode]
          const diskRec = diskTable[target] ?? { positive: 0, negative: 0 }
          diskRec[rating] += 1
          if (note !== undefined) diskRec.lastNote = note
          diskTable[target] = diskRec
          this.state = diskState
          return Promise.resolve(JSON.stringify(diskState, null, 2))
        })
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
    // rc.66: records land inside the transact, so no flush is needed at
    // unload — wait for the pending record task chain instead (the same
    // fire-and-forget safety rc.50 P2-12 provided via flush).
    return feedback.waitIdle()
  }, 'evolution-feedback.records')
}
