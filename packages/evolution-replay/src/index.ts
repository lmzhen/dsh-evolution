/**
 * Replay/A-B evaluation primitives for evolution plans.
 * Pure and deterministic; no model or DSH runtime dependency.
 * @module @deepseek-ai/dsh-evolution-replay
 */

export interface ReplayPlan {
  policyId: string
  acceptedOps: number
  rejectedOps: number
  memoryOps: number
  skillOps: number
  evidenceQuotes: number
  estimatedInputChars: number
}

export interface ReplayResult {
  winner: string | null
  margin: number
  plans: ReplayPlan[]
  report: string
}

export interface ReplayWeights {
  accepted: number
  rejectedPenalty: number
  evidence: number
  cost: number
}

export const DEFAULT_WEIGHTS: ReplayWeights = {
  accepted: 10,
  rejectedPenalty: 15,
  evidence: 2,
  cost: 0.001,
}

export function scorePlan(plan: ReplayPlan, weights: ReplayWeights = DEFAULT_WEIGHTS): number {
  return plan.acceptedOps * weights.accepted
    - plan.rejectedOps * weights.rejectedPenalty
    + plan.evidenceQuotes * weights.evidence
    - plan.estimatedInputChars * weights.cost
}

export function comparePlans(plans: ReplayPlan[], weights: ReplayWeights = DEFAULT_WEIGHTS): ReplayResult {
  if (plans.length === 0) return { winner: null, margin: 0, plans, report: 'No plans to compare.' }
  const scored = plans.map(plan => ({ plan, score: scorePlan(plan, weights) })).sort((a, b) => b.score - a.score)
  const winner = scored[0]!
  const margin = scored.length > 1 ? winner.score - scored[1]!.score : winner.score
  return {
    winner: winner.plan.policyId,
    margin,
    plans,
    report: scored.map(({ plan, score }) => `${plan.policyId}: ${score.toFixed(1)} (${plan.acceptedOps} accepted, ${plan.rejectedOps} rejected)`).join('\n'),
  }
}

export const name = 'evolution-replay'

export function apply(): void {
  // Library plugin: consumers import comparePlans / scorePlan directly.
}
