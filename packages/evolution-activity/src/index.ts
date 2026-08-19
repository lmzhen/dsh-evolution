/**
 * Session projection for self-evolution activity.
 * @module @deepseek-ai/dsh-evolution-activity
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'

export interface EvolutionActivityItem {
  planId: string
  kind: string
  memoryApplied: number
  skillApplied: number
  rejectedOps: number
  at: number
}

export interface EvolutionActivityProjection {
  items: EvolutionActivityItem[]
}

export interface State {
  items: EvolutionActivityItem[]
}

// Projection schemas belong to `dsh-session-projection`, which reads them by
// calling `def.schema.parse(...)`. That contract requires zod: schemastery
// schemas expose `resolve()` instead of `parse()` and break session-history
// loads at runtime. Plugin `Config`, by contrast, stays schemastery.
const activitySchema = zod.object({
  items: zod.array(zod.object({
    planId: zod.string(),
    kind: zod.string(),
    memoryApplied: zod.number().min(0),
    skillApplied: zod.number().min(0),
    rejectedOps: zod.number().min(0),
    at: zod.number().min(0),
  })),
})

type SessionEventLike =
  | { type: 'evolution/plan-applied'; data: { planId: string; memoryApplied: number; skillApplied: number; rejectedOps: number }; time: number }
  | { type: string }

export function applyState(state: State, event: SessionEventLike, maxItems = 20): State {
  if (event.type !== 'evolution/plan-applied') return state
  const data = (event as { data: { planId: string; memoryApplied: number; skillApplied: number; rejectedOps: number }; time: number }).data
  const time = (event as { time: number }).time
  return {
    items: [
      ...state.items,
      {
        planId: data.planId,
        kind: 'plan',
        memoryApplied: data.memoryApplied,
        skillApplied: data.skillApplied,
        rejectedOps: data.rejectedOps,
        at: time,
      },
    ].slice(-maxItems),
  }
}

export const name = 'evolution-activity'

export interface Config {
  maxItems?: number
}

export const Config: z<Config> = z.object({
  maxItems: z.number().default(20),
})

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const maxItems = rawConfig.maxItems ?? 20
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    const runtime = (projectionCtx as unknown as {
      sessionProjections: {
        register(definition: {
          key: string
          schema: unknown
          init(): State
          apply(state: State, event: unknown): State
          view(state: State): EvolutionActivityProjection
          stateVersion: number
        }): () => void
      }
    }).sessionProjections
    runtime.register({
      key: 'evolution-activity',
      schema: activitySchema,
      init: () => ({ items: [] }),
      apply: (state, event) => applyState(state, event as SessionEventLike, maxItems),
      view: state => ({ items: state.items }),
      stateVersion: 1,
    })
  })
}
