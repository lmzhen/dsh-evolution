/**
 * Durable session events emitted by the evolution family.
 * These are non-surface events: they never enter model history, but make
 * self-evolution activity replayable and observable by UI/projections.
 */

import type {} from '@deepseek-ai/dsh-session/types'

export interface EvolutionReviewScheduledEvent {
  kind: 'memory' | 'skill' | 'combined'
  toolCalls: number
  userChars: number
  assistantChars: number
}

export interface EvolutionPlanAppliedEvent {
  planId: string
  memoryApplied: number
  skillApplied: number
  rejectedOps: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'evolution/review-scheduled': EvolutionReviewScheduledEvent
    'evolution/plan-applied': EvolutionPlanAppliedEvent
  }
}
