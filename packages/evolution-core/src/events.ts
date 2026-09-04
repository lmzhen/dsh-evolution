/**
 * Process-local events emitted by the evolution family on the cordis event
 * bus. Consumers subscribe with `ctx.on(...)`; producers dispatch with
 * `ctx.emit(...)`.
 *
 * These are deliberately NOT session events: a persisted session log may only
 * contain types from the host's generated `KNOWN_SESSION_EVENT_TYPES` set —
 * the persistence read path refuses to interpret a log carrying any other
 * type unless the envelope marks it `ignorable`, and `Session.append` offers
 * no channel to write that marker. Appending any `evolution/*` type therefore
 * made the whole session unresumable (A-line P0-1, fixed in rc.42 by moving
 * these events off `session.append`). Plan-outcome durability lives in the
 * evolution-activity store, not the session log.
 */

import type {} from '@deepseek-ai/cordis'

export interface EvolutionReviewScheduledEvent {
  /** Owning session (payload v2): process events carry no session envelope. */
  sessionId: string
  kind: 'memory' | 'skill' | 'combined'
  toolCalls: number
  userChars: number
  assistantChars: number
}

export interface EvolutionPlanAppliedEvent {
  /** Owning session (payload v2): process events carry no session envelope. */
  sessionId: string
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
  /** 0.3.16 (E-50): was `filePath` with mixed semantics — skill-directory ops
   * carried the DIRECTORY while file ops (write_file/remove_file) carried the
   * FILE path. Split into explicit fields so a subscriber can distinguish. */
  skillDir?: string
  file?: string
  archivedPath?: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'evolution/review-scheduled'(event: EvolutionReviewScheduledEvent): void
    'evolution/plan-applied'(event: EvolutionPlanAppliedEvent): void
    'evolution/skill-mutated'(event: EvolutionSkillMutatedEvent): void
  }
}
