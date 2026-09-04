/**
 * Replay/A-B evaluation for evolution plans.
 *
 * The pure scoring functions remain deterministic and runtime-free. The DSH
 * driver records every `evolution/plan-applied` process event (payload v2,
 * with sessionId) into an in-memory leaderboard and exposes `/evolution
 * replay` (via the `/evolution` command family) for comparison, so a human can
 * A/B review policy/prompt changes against real plan outcomes. Durability
 * across restarts is the evolution-activity store's job; this leaderboard is
 * deliberately in-memory.
 * @module @deepseek-ai/dsh-evolution-replay
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { EvolutionPlanAppliedEvent } from '@deepseek-ai/dsh-evolution-core'

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

export interface Config {
  maxPlans?: number
  weights?: ReplayWeights
}

export const Config: z<Config> = z.object({
  maxPlans: z.number().default(50),
  weights: z.object({
    accepted: z.number().default(10),
    rejectedPenalty: z.number().default(15),
    evidence: z.number().default(2),
    cost: z.number().default(0.001),
  }).default(DEFAULT_WEIGHTS),
})

function scorePlan(plan: ReplayPlan, weights: ReplayWeights = DEFAULT_WEIGHTS): number {
  return plan.acceptedOps * weights.accepted
    - plan.rejectedOps * weights.rejectedPenalty
    + plan.evidenceQuotes * weights.evidence
    - plan.estimatedInputChars * weights.cost
}

export function comparePlans(plans: ReplayPlan[], weights: ReplayWeights = DEFAULT_WEIGHTS): ReplayResult {
  if (plans.length === 0) return { winner: null, margin: 0, plans, report: 'No plans to compare.' }
  const scored = plans.map(plan => ({ plan, score: scorePlan(plan, weights) })).sort((a, b) => b.score - a.score)
  const winner = scored[0]
  if (!winner) return { winner: null, margin: 0, plans, report: 'No plans to compare.' }
  const runnerUp = scored[1]
  const margin = runnerUp ? winner.score - runnerUp.score : winner.score
  return {
    winner: winner.plan.policyId,
    margin,
    plans,
    report: scored.map(({ plan, score }) => `${plan.policyId}: ${score.toFixed(1)} (${plan.acceptedOps} accepted, ${plan.rejectedOps} rejected)`).join('\n'),
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionReplay: EvolutionReplayDriver
  }
}

export class EvolutionReplayDriver {
  private readonly plans: ReplayPlan[] = []
  private readonly maxPlans: number
  private readonly weights: ReplayWeights

  constructor(config: Config = {}) {
    this.maxPlans = config.maxPlans ?? 50
    this.weights = config.weights ?? DEFAULT_WEIGHTS
  }

  record(plan: EvolutionPlanAppliedEvent): void {
    this.plans.push({
      // 0.3.17 (E-76): an EMPTY policyFingerprint counts as missing — the
      // leaderboard used to show a nameless "" entry (empty-string checks pass
      // through typeof).
      policyId: typeof plan.policyFingerprint === 'string' && plan.policyFingerprint.length > 0 ? plan.policyFingerprint : plan.planId,
      acceptedOps: plan.memoryApplied + plan.skillApplied,
      rejectedOps: plan.rejectedOps,
      memoryOps: plan.memoryApplied,
      skillOps: plan.skillApplied,
      evidenceQuotes: typeof plan.evidenceQuotes === 'number' ? plan.evidenceQuotes : plan.memoryApplied + plan.skillApplied,
      estimatedInputChars: typeof plan.estimatedInputChars === 'number' ? plan.estimatedInputChars : 0,
    })
    if (this.plans.length > this.maxPlans) this.plans.shift()
  }

  plansSnapshot(): ReplayPlan[] {
    return [...this.plans]
  }

  compare(weights: ReplayWeights = this.weights): ReplayResult {
    return comparePlans(this.plans, weights)
  }
}

export const name = 'evolution-replay'

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const driver = new EvolutionReplayDriver(rawConfig)
  ctx.provide('evolutionReplay', driver)
  ctx.on('evolution/plan-applied', (event) => {
    driver.record(event)
  })
}

