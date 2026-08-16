/**
 * Background review orchestration: signal gate → one-shot subagent → trusted plan execution.
 * @module @deepseek-ai/dsh-evolution-review
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import { advanceReview, foldTurn, type ReviewKind, type ReviewState } from '@deepseek-ai/dsh-evolution/src/signals.ts'
import { reviewPrompt } from '@deepseek-ai/dsh-evolution/src/prompts.ts'
import type {} from '@deepseek-ai/dsh-evolution/src/events.ts'
import { validateEvolutionPlan } from '@deepseek-ai/dsh-evolution-plan-validator'

export const name = 'evolution-review'
export const inject = ['agents', 'tools']

export interface Config {
  reviewEnabled?: boolean
  reviewMode?: string
  memoryInterval?: number
  skillInterval?: number
}

export const Config: z<Config> = z.object({
  reviewEnabled: z.boolean().default(true),
  reviewMode: z.string().default('subagent'),
  memoryInterval: z.number().default(10),
  skillInterval: z.number().default(10),
})

interface SubagentLike {
  start(name: string, request: unknown): Promise<{ result: Promise<{ structured?: unknown }>; dispose(): Promise<void> }>
}

interface EvolutionPlan {
  memoryOps?: Array<{ target?: string; action?: string; facts?: string; content?: string; old_text?: string; evidence?: unknown[] }>
  skillOps?: Array<{ action?: string; name?: string; content?: string; old_string?: string; new_string?: string; evidence?: unknown[] }>
}

interface MemoryLike {
  applyBatch(target: 'memory' | 'user', operations: unknown[]): Promise<{ ok: boolean; message: string }>
}

export function apply(ctx: Context, rawConfig: Config): void {
  const config = rawConfig as Required<Config>
  const states = new Map<SessionId, ReviewState>()
  const turnStarts = new Map<SessionId, number>()

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') turnStarts.set(session.id, session.seq - 1)
    if (event.type !== 'turn/end') return
    void onTurnEnd(session, event)
  })

  async function onTurnEnd(session: Session, event: SessionEvent<'turn/end'>): Promise<void> {
    if (!config.reviewEnabled) return
    if (session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0) return
    const agent = ctx.agents.get(session.id)
    if (!agent) return
    const signal = foldTurn(session, turnStarts.get(session.id) ?? Math.max(0, session.seq - 1))
    turnStarts.delete(session.id)
    const state = states.get(session.id) ?? { turnsSinceMemory: 0, turnsSinceSkill: 0, lastTurn: -1 }
    const kind = advanceReview(state, event.data.turn, signal, {
      memoryInterval: config.memoryInterval,
      skillInterval: config.skillInterval,
      substantiveMinToolCalls: 3,
      substantiveMinUserChars: 200,
      substantiveMinAgentChars: 500,
    })
    states.set(session.id, state)
    if (!kind) return

    const started = await trySubagentReview(session, agent, kind, signal)
    if (!started) {
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: reviewPrompt(kind) }],
        source: { kind: 'plugin', plugin: 'dsh-evolution-review', form: 'notice', summary: 'auto-review' },
      }))
    }
  }

  async function trySubagentReview(session: Session, agent: import('@deepseek-ai/dsh-agent').Agent, kind: ReviewKind, signal: unknown): Promise<boolean> {
    if (config.reviewMode === 'inject') return false
    const subagents = ctx.get('subagents') as SubagentLike | undefined
    if (!subagents) return false
    try {
      const run = await subagents.start('spawn', {
        label: 'dsh-evolution-review',
        prompt: [{ type: 'text', text: buildReviewRequest(session, kind, signal as { toolCalls: number; userChars: number; assistantChars: number }) }],
        parent: agent,
        signal: AbortSignal.timeout(120_000),
        maxDepth: 0,
        persona: reviewPrompt(kind),
        toolFilter: { allow: ['skill'] },
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            memoryOps: { type: 'array', items: { type: 'json' } },
            skillOps: { type: 'array', items: { type: 'json' } },
            summary: { type: 'string' },
          },
        },
      })
      const result = await run.result
      await run.dispose()
      if (!result.structured) return true
      const policy = ctx.get('evolutionPolicy') as {
        get(): { maxOpsPerPlan: number; protectedSkillNames: readonly string[]; memoryChars: number; skillContentChars: number }
      } | undefined
      const validation = validateEvolutionPlan(result.structured as EvolutionPlan, {
        sessionSeq: session.seq - 1,
        maxOpsPerPlan: policy?.get().maxOpsPerPlan ?? 32,
        protectedSkillNames: new Set(policy?.get().protectedSkillNames ?? []),
        maxMemoryChars: policy?.get().memoryChars ?? 2200,
        maxSkillContentChars: policy?.get().skillContentChars ?? 100_000,
      })
      const actions = await executePlan(validation.accepted, agent)
      session.append('evolution/plan-applied', {
        planId: Math.random().toString(36).slice(2),
        memoryApplied: actions.filter(action => action.startsWith('Memory')).length,
        skillApplied: actions.filter(action => action.startsWith('Skill ')).length,
        rejectedOps: validation.rejected.length,
      })
      if (actions.length > 0) {
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: `💾 Self-improvement review: ${actions.join(' · ')}` }],
          source: { kind: 'plugin', plugin: 'dsh-evolution-review', form: 'notice', summary: 'self-improvement review' },
        }))
      }
      return true
    } catch {
      return false
    }
  }

  async function executePlan(plan: EvolutionPlan, parent: import('@deepseek-ai/dsh-agent').Agent): Promise<string[]> {
    const memory = ctx.get('memory') as MemoryLike | undefined
    const actions: string[] = []
    for (const op of plan.memoryOps ?? []) {
      if (!Array.isArray(op.evidence) || op.evidence.length === 0 || !memory) continue
      const result = await memory.applyBatch(op.target === 'user' ? 'user' : 'memory', [op])
      if (result.ok) actions.push('Memory updated')
    }
    for (const op of plan.skillOps ?? []) {
      if (!Array.isArray(op.evidence) || op.evidence.length === 0 || !op.name) continue
      const result = await ctx.tools.execute({
        callId: CallId(`evolution-${Math.random().toString(36).slice(2)}`),
        name: 'skill_manage',
        arguments: op,
        agent: parent,
        signal: AbortSignal.timeout(30_000),
      })
      if (!result.isError) actions.push(`Skill ${op.name} ${op.action ?? 'patch'}`)
    }
    return actions
  }

  ctx.effect(() => () => {
    states.clear()
    turnStarts.clear()
  }, 'dsh-evolution-review.cleanup')
}

function buildReviewRequest(session: Session, kind: ReviewKind, signal: { toolCalls: number; userChars: number; assistantChars: number }): string {
  const messages: string[] = []
  const surface = session.deriveMessages()
  for (const message of surface.slice(-60)) {
    if (message.role === 'user' || message.role === 'assistant') {
      const text = message.content.map(block => block.type === 'text' ? block.text : '').join(' ').trim()
      if (text) messages.push(`${message.role.toUpperCase()}: ${text.slice(0, 2000)}`)
    }
  }
  return [
    `Review kind: ${kind}`,
    `Signals: ${signal.toolCalls} tool calls, ${signal.userChars} user chars, ${signal.assistantChars} assistant chars.`,
    'Return ONLY the structured JSON plan. Evidence is mandatory for every op.',
    '',
    ...messages,
  ].join('\n')
}
