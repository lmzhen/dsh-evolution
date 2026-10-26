/** Pure recovery planner and timeout decision. No IO. */
import type { CommitReceipt } from './model.ts'

export type RecoveryDecision =
  | { readonly kind: 'retry'; readonly reason: 'no-intent' }
  | { readonly kind: 'committed'; readonly receipt: CommitReceipt }
  | { readonly kind: 'roll-forward'; readonly reason: 'effects-complete' | 'after-hash-matches' }
  | { readonly kind: 'abort'; readonly reason: 'no-effects' | 'before-hash-matches' }
  | { readonly kind: 'blocked'; readonly reason: 'partial-effects' }

export interface RecoveryObservation {
  readonly hasIntent: boolean
  readonly hasReceipt: boolean
  readonly receipt?: CommitReceipt
  readonly beforeMatches: boolean
  readonly afterMatches: boolean
  readonly effects: 'none' | 'partial' | 'complete'
}

export function planRecovery(observation: RecoveryObservation): RecoveryDecision {
  if (observation.hasReceipt) {
    if (observation.receipt === undefined) return { kind: 'blocked', reason: 'partial-effects' }
    return { kind: 'committed', receipt: observation.receipt }
  }
  if (!observation.hasIntent) return { kind: 'retry', reason: 'no-intent' }
  if (observation.effects === 'complete' || observation.afterMatches) return { kind: 'roll-forward', reason: observation.effects === 'complete' ? 'effects-complete' : 'after-hash-matches' }
  if (observation.effects === 'none' || observation.beforeMatches) return { kind: 'abort', reason: observation.effects === 'none' ? 'no-effects' : 'before-hash-matches' }
  return { kind: 'blocked', reason: 'partial-effects' }
}

export type TimeoutDecision = 'failed' | 'unknown'

/** Before a durable intent, timeout is a normal failed run; after it, only recovery may decide. */
export function timeoutDecision(unitPrepared: boolean): TimeoutDecision {
  return unitPrepared ? 'unknown' : 'failed'
}
