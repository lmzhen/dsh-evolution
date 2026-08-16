/**
 * Session projection for self-evolution activity.
 * @module @deepseek-ai/dsh-evolution-activity
 */

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'

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

interface State {
  items: EvolutionActivityItem[]
}

const activitySchema = z.object({
  items: z.array(z.object({
    planId: z.string(),
    kind: z.string(),
    memoryApplied: z.number().int().nonnegative(),
    skillApplied: z.number().int().nonnegative(),
    rejectedOps: z.number().int().nonnegative(),
    at: z.number().nonnegative(),
  })),
})

type SessionEventLike =
  | { type: 'evolution/plan-applied'; data: { planId: string; memoryApplied: number; skillApplied: number; rejectedOps: number }; time: number }
  | { type: string }

export function applyState(state: State, event: SessionEventLike): State {
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
    ].slice(-20),
  }
}

export const name = 'evolution-activity'

export function apply(ctx: Context): void {
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
      apply: (state, event) => applyState(state, event as SessionEventLike),
      view: state => ({ items: state.items }),
      stateVersion: 1,
    })
  })
}
