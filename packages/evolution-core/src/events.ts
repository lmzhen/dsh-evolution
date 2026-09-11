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
import type { ReviewKind } from './signals.ts'

export interface EvolutionReviewScheduledEvent {
  /** Owning session (payload v2): process events carry no session envelope. */
  sessionId: string
  /** F-20 (v18): single definition point — `ReviewKind` in signals.ts. */
  kind: ReviewKind
  toolCalls: number
  userChars: number
  assistantChars: number
  /** V24-15 (v24): which delivery channel actually sent the review. The
   * emission point was previously covered on only two of the four delivery
   * paths (subagent success + completion inject), so a consumer on the
   * default inject-mode deployment would have silently missed every cadence
   * review. Every delivery path now emits with its channel:
   * `'subagent'` (spawned review run), `'inject'` (prompt injected into the
   * parent — direct, fallback, or deferred-drain), `'completion'`
   * (completion-trigger prompt, direct or deferred-drain). */
  channel?: 'subagent' | 'inject' | 'completion' | undefined
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
  /** 0.3.31 (V5-19): execution-layer failures — ops that reached execution but
   * did not land (non-throw `ok:false` results). `rejectedOps` counts only
   * VALIDATION rejects; a consumer that treats rejectedOps as "work not done"
   * would otherwise miss a partial application. */
  executionFailures?: number | undefined
  /** First execution-layer failure message (abort reason or op failure). */
  executionError?: string | undefined
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

/** 0.3.18 (E-6): a turn-end review pipeline failure was caught (never an
 * unhandled rejection); this event lets operators/observability see it. The
 * reason is already logged by the emitter — the event is a timestamped signal. */
export interface EvolutionReviewErrorEvent {
  sessionId: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'evolution/review-scheduled'(event: EvolutionReviewScheduledEvent): void
    'evolution/plan-applied'(event: EvolutionPlanAppliedEvent): void
    'evolution/skill-mutated'(event: EvolutionSkillMutatedEvent): void
    /** 0.3.18 (E-71): explicit catalog refresh request (`/evolution skills
     * refresh`). Out-of-band tree edits (manual, git) may bypass the mutation
     * event; listeners drop caches and invalidate downstream catalogs. No
     * payload — it is a bare "re-read" signal, never a mutation record. */
    'evolution/skills-refresh'(): void
    'evolution/review-error'(event: EvolutionReviewErrorEvent): void
  }
}
