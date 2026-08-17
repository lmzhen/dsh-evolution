/**
 * Replay/A-B evaluation for evolution plans.
 *
 * The pure scoring functions remain deterministic and runtime-free. The DSH
 * driver records every `evolution/plan-applied` session event into an
 * in-memory leaderboard and exposes `/evolution replay` for comparison, so a
 * human can A/B review policy/prompt changes against real plan outcomes.
 * @module @deepseek-ai/dsh-evolution-replay
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-evolution-core'

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

export function scorePlan(plan: ReplayPlan, weights: ReplayWeights = DEFAULT_WEIGHTS): number {
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

  record(event: {
    type: string
    data: {
      planId: string
      policyFingerprint?: string | undefined
      memoryApplied: number
      skillApplied: number
      rejectedOps: number
      evidenceQuotes?: number | undefined
      estimatedInputChars?: number | undefined
    }
  }): void {
    if (event.type !== 'evolution/plan-applied') return
    const data = event.data
    this.plans.push({
      policyId: typeof data.policyFingerprint === 'string' ? data.policyFingerprint : data.planId,
      acceptedOps: data.memoryApplied + data.skillApplied,
      rejectedOps: data.rejectedOps,
      memoryOps: data.memoryApplied,
      skillOps: data.skillApplied,
      evidenceQuotes: typeof data.evidenceQuotes === 'number' ? data.evidenceQuotes : data.memoryApplied + data.skillApplied,
      estimatedInputChars: typeof data.estimatedInputChars === 'number' ? data.estimatedInputChars : 0,
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
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'evolution/plan-applied') driver.record(event)
  })
  ctx.inject(['commands'], (commandCtx) => {
    const commands = (commandCtx as unknown as { commands: { register(definition: unknown): () => void } }).commands
    commands.register({
      name: 'evolution replay',
      description: 'Compare recent evolution plan outcomes',
      recordInput: false,
      handler: () => ({ text: driver.compare().report }),
    })
  })
}

export default EvolutionReplayDriver
