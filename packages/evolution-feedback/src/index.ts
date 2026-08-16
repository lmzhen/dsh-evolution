/**
 * Feedback-to-quality scoring for self-evolution.
 * @module @deepseek-ai/dsh-evolution-feedback
 */

import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionFeedback: EvolutionFeedback
  }
}

export interface FeedbackRecord {
  positive: number
  negative: number
  lastNote?: string
}

export interface FeedbackState {
  skills: Record<string, FeedbackRecord>
  sessions: Record<string, FeedbackRecord>
}

export class EvolutionFeedback {
  private state: FeedbackState = { skills: {}, sessions: {} }

  constructor() {}

  record(target: string, rating: 'positive' | 'negative', note?: string, kind: 'skill' | 'session' = 'session'): void {
    const table = kind === 'skill' ? this.state.skills : this.state.sessions
    const current = table[target] ?? { positive: 0, negative: 0 }
    current[rating] += 1
    if (note !== undefined) current.lastNote = note
    table[target] = current
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
}

export const name = 'evolution-feedback'

export function apply(ctx: Context): void {
  ctx.provide('evolutionFeedback', new EvolutionFeedback())
}

export default EvolutionFeedback
