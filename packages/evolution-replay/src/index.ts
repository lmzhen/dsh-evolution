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
import { clampedNumber } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionPlanAppliedEvent } from '@deepseek-ai/dsh-evolution-core'

export interface ReplayPlan {
  policyId: string
  acceptedOps: number
  rejectedOps: number
  memoryOps: number
  skillOps: number
  evidenceQuotes: number
  estimatedInputChars: number
  /** V6-10 (0.3.36): execution-layer failures — a plan must not read as a
   * clean "0/0" when its ops all failed at execution (V5-19 payload). */
  executionFailures?: number | undefined
  executionError?: string | undefined
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

/** The four clampable weight fields, in report order (V4-40 warn). */
const WEIGHT_FIELDS: Array<keyof ReplayWeights> = ['accepted', 'rejectedPenalty', 'evidence', 'cost']

export interface Config {
  maxPlans?: number
  weights?: ReplayWeights
}

export const Config: z<Config> = z.object({
  maxPlans: z.number().min(1).default(50),
  weights: z.object({
    accepted: z.number().min(1).default(10),
    rejectedPenalty: z.number().min(1).default(15),
    evidence: z.number().min(1).default(2),
    cost: z.number().min(0).default(0.001),
  }).default(DEFAULT_WEIGHTS),
})

/**
 * Clamp a weights object to its per-field domain (G3.1). `accepted`,
 * `rejectedPenalty` and `evidence` are positive multipliers (min 1 — a zero or
 * negative weight would silently drop a scoring term or reverse its sign);
 * `cost` may be 0 (0 means "no cost penalty"), so its min is 0. NaN, ±Infinity
 * and out-of-range values fall back to the default for that field.
 */
export function clampReplayWeights(weights: ReplayWeights | undefined, fallback: ReplayWeights = DEFAULT_WEIGHTS): ReplayWeights {
  return {
    accepted: clampedNumber(weights?.accepted, fallback.accepted, { min: 1 }),
    rejectedPenalty: clampedNumber(weights?.rejectedPenalty, fallback.rejectedPenalty, { min: 1 }),
    evidence: clampedNumber(weights?.evidence, fallback.evidence, { min: 1 }),
    cost: clampedNumber(weights?.cost, fallback.cost, { min: 0 }),
  }
}

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
    report: scored.map(({ plan, score }) => `${plan.policyId}: ${score.toFixed(1)} (${plan.acceptedOps} accepted, ${plan.rejectedOps} rejected${(plan.executionFailures ?? 0) > 0 ? `, ${plan.executionFailures} failed${plan.executionError !== undefined ? `: ${plan.executionError}` : ''}` : ''})`).join('\n'),
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

  constructor(config: Config = {}, warn: (message: string) => void = () => {}) {
    // G3.1 (0.3.23): clamp maxPlans and weights. A 0/negative/NaN/±Infinity
    // maxPlans would break the size bound; the weights clamp keeps every term
    // in its valid domain. The schema `.min(1)` rejects 0/negative; these
    // clamps also cover NaN/±Infinity (the number schema lets them through).
    const maxPlans = clampedNumber(config.maxPlans ?? 50, 50, { min: 1 })
    this.maxPlans = maxPlans
    if (config.maxPlans !== undefined && maxPlans !== config.maxPlans) {
      warn(`evolution-replay: maxPlans=${String(config.maxPlans)} is invalid; falling back to the default 50`)
    }
    // V4-40: clamp the weights the same way, but surface a single warn when any
    // field had to be corrected — the maxPlans clamp already warns, and a silent
    // weights clamp would hide a mis-scored A/B comparison. cost's 0 is legal
    // (no cost penalty), so it is only flagged when actually out of range.
    const rawWeights = config.weights
    this.weights = clampReplayWeights(rawWeights)
    if (rawWeights !== undefined) {
      // Only flag fields the caller EXPLICITLY provided that had to be clamped —
      // an absent field defaults legitimately and must not warn.
      const clampedFields = WEIGHT_FIELDS.filter(field => field in rawWeights && this.weights[field] !== rawWeights[field])
      if (clampedFields.length > 0) {
        warn(`evolution-replay: weights ${clampedFields.join(', ')} provided an invalid value; falling back to the default`)
      }
    }
  }

  record(plan: EvolutionPlanAppliedEvent): void {
    // P3-23 (v14): the op counters arrive from a persisted session event, so a
    // malformed log entry (missing/NaN/non-number) used to poison `acceptedOps`
    // with NaN and every score derived from it. Same finite-number discipline
    // as the other guarded fields below.
    // P2-2 (v15): the guard now covers ALL SIX numeric fields — the first cut
    // left `evidenceQuotes`/`estimatedInputChars`/`executionFailures` on bare
    // `typeof` checks, and `typeof NaN === 'number'` let them straight into
    // `scorePlan` (evidence is a scored dimension) — the exact poisoning the
    // fix claimed to close. `count` also refuses negatives: a counter cannot
    // be negative and a negative value distorts the ranking.
    const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
    const countOr = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback)
    const memoryApplied = count(plan.memoryApplied)
    const skillApplied = count(plan.skillApplied)
    this.plans.push({
      // 0.3.17 (E-76): an EMPTY policyFingerprint counts as missing — the
      // leaderboard used to show a nameless "" entry (empty-string checks pass
      // through typeof).
      policyId: typeof plan.policyFingerprint === 'string' && plan.policyFingerprint.length > 0 ? plan.policyFingerprint : plan.planId,
      acceptedOps: memoryApplied + skillApplied,
      rejectedOps: count(plan.rejectedOps),
      memoryOps: memoryApplied,
      skillOps: skillApplied,
      // A missing evidenceQuotes keeps the E-76-era heuristic (≈ applied ops);
      // a malformed one (NaN/∞/negative) is treated the same way instead of
      // poisoning the scored dimension.
      evidenceQuotes: countOr(plan.evidenceQuotes, memoryApplied + skillApplied),
      estimatedInputChars: count(plan.estimatedInputChars),
      // V6-10 (0.3.36): keep the failure dimension for the leaderboard —
      // a plan whose ops all failed must not score as a clean empty plan.
      // E4 (P1-10, v11): the failure dimension is a REPORT-ONLY field (shown
      // in the leaderboard text); scorePlan intentionally weighs only
      // accepted/rejected/evidence/cost — execution failures and validation
      // rejections score differently BY DESIGN (the operational layers differ:
      // rejected ops were prevented, failed ops were attempted). The V6-10
      // comment above was the only place claiming a score equality it does
      // not implement; the score function below is the authority.
      executionFailures: count(plan.executionFailures),
      ...typeof plan.executionError === 'string' ? { executionError: plan.executionError } : {},
    })
    if (this.plans.length > this.maxPlans) this.plans.shift()
  }

  /**
   * F-11: test-support API — no production consumer reads the raw
   * plan list (the leaderboard path goes through `compare()`); tests use this
   * as a read/inspection window. Kept by declaration (same posture as the
   * skill-usage `invalidate()` V6-44 declaration), so it is documented intent
   * rather than undeclared dead code.
   */
  plansSnapshot(): ReplayPlan[] {
    return [...this.plans]
  }

  compare(weights: ReplayWeights = this.weights): ReplayResult {
    // P3 (v15): sort on a COPY — `comparePlans` sorts its argument in place,
    // and `this.plans` used to be handed over by reference, so a consumer
    // sorting/reordering `result.plans` mutated the driver's live leaderboard
    // (inconsistent with `plansSnapshot()`'s deliberate copy).
    return comparePlans([...this.plans], weights)
  }
}

export const name = 'evolution-replay'

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const driver = new EvolutionReplayDriver(rawConfig, (message) => {
    ctx.logger.warn(message)
  })
  ctx.provide('evolutionReplay', driver)
  ctx.on('evolution/plan-applied', (event) => {
    driver.record(event)
  })
}

