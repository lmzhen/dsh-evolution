/**
 * Durable session events emitted by the evolution family.
 * These are non-surface events: they never enter model history, but make
 * self-evolution activity replayable and observable by UI/projections.
 */

import type {} from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/cordis'

export interface EvolutionReviewScheduledEvent {
  kind: 'memory' | 'skill' | 'combined'
  toolCalls: number
  userChars: number
  assistantChars: number
}

export interface EvolutionPlanAppliedEvent {
  planId: string
  /** Stable fingerprint of the policy snapshot that produced this plan. */
  policyFingerprint?: string | undefined
  memoryApplied: number
  skillApplied: number
  rejectedOps: number
  evidenceQuotes?: number | undefined
  estimatedInputChars?: number | undefined
}

export interface EvolutionSkillMutatedEvent {
  action: string
  name: string
  filePath?: string
  archivedPath?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'evolution/review-scheduled': EvolutionReviewScheduledEvent
    'evolution/plan-applied': EvolutionPlanAppliedEvent
    'evolution/skill-mutated': EvolutionSkillMutatedEvent
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'evolution/skill-mutated'(event: EvolutionSkillMutatedEvent): void
  }
}
