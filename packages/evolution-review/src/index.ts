/**
 * Background review orchestration: signal gate → one-shot subagent → trusted plan execution.
 * @module @deepseek-ai/dsh-evolution-review
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import { advanceReview, foldTurn, type ReviewKind, type ReviewState } from '@deepseek-ai/dsh-evolution/src/signals.ts'
import type {} from '@deepseek-ai/dsh-evolution-state'
import { PROMPT_BUNDLE, reviewPrompt, verifyPromptBundle } from '@deepseek-ai/dsh-evolution/src/prompts.ts'
import type {} from '@deepseek-ai/dsh-evolution/src/events.ts'
import { validateEvolutionPlan } from '@deepseek-ai/dsh-evolution-plan-validator'

export const name = 'evolution-review'
export const inject = ['agents', 'tools']

export interface Config {
  reviewEnabled?: boolean
  reviewMode?: string
  memoryInterval?: number
  skillInterval?: number
  /** Tools the one-shot review subagent may use. Defaults include the Anchored Standard discovery pair. */
  reviewToolAllow?: string[]
}

export const Config: z<Config> = z.object({
  reviewEnabled: z.boolean().default(true),
  reviewMode: z.string().default('subagent'),
  memoryInterval: z.number().default(10),
  skillInterval: z.number().default(10),
  reviewToolAllow: z.array(z.string()).default(['skill', 'skill_search', 'skill_load']),
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

interface ApprovalLike {
  request(input: { kind: 'memory' | 'skill'; summary: string; args: unknown; origin: 'foreground' | 'background_review' }): Promise<{ action: 'allow' | 'staged'; pendingId?: string; message: string }>
  run(kind: 'memory' | 'skill', args: unknown): Promise<{ ok: boolean; message: string }>
}

interface PolicyLike {
  get(): {
    reviewMemoryInterval: number
    reviewSkillInterval: number
    substantiveMinToolCalls: number
    substantiveMinUserChars: number
    substantiveMinAgentChars: number
    reviewMode: 'subagent' | 'inject'
    maxOpsPerPlan: number
    protectedSkillNames: readonly string[]
    memoryChars: number
    skillContentChars: number
  }
}

export function apply(ctx: Context, rawConfig: Config): void {
  if (!verifyPromptBundle(PROMPT_BUNDLE)) {
    throw new Error('dsh-evolution prompt bundle integrity check failed; refusing to schedule review work')
  }
  const config = rawConfig as Required<Config>
  const turnStarts = new Map<SessionId, number>()
  const policy = () => (ctx.get('evolutionPolicy') as PolicyLike | undefined)?.get()

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') turnStarts.set(session.id, session.seq - 1)
    if (event.type !== 'turn/end') return
    void onTurnEnd(session, event)
  })

  async function onTurnEnd(session: Session, event: SessionEvent<'turn/end'>): Promise<void> {
    if (!config.reviewEnabled) return
    if (session.header.origin === 'subagent') return
    const agent = ctx.agents.get(session.id)
    if (!agent) return
    const signal = foldTurn(session, turnStarts.get(session.id) ?? Math.max(0, session.seq - 1))
    turnStarts.delete(session.id)
    const stateService = ctx.get('evolutionState') as {
      loadReviewState(id: string): Promise<ReviewState | null>
      saveReviewState(id: string, record: ReviewState): Promise<void>
    } | undefined
    const state = await stateService?.loadReviewState(session.id) ?? { turnsSinceMemory: 0, turnsSinceSkill: 0, lastTurn: -1 }
    const snapshot = policy()
    const kind = advanceReview(state, event.data.turn, signal, {
      memoryInterval: snapshot?.reviewMemoryInterval ?? config.memoryInterval,
      skillInterval: snapshot?.reviewSkillInterval ?? config.skillInterval,
      substantiveMinToolCalls: snapshot?.substantiveMinToolCalls ?? 3,
      substantiveMinUserChars: snapshot?.substantiveMinUserChars ?? 200,
      substantiveMinAgentChars: snapshot?.substantiveMinAgentChars ?? 500,
    })
    await stateService?.saveReviewState(session.id, state)
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
    if ((policy()?.reviewMode ?? config.reviewMode) === 'inject') return false
    const subagents = ctx.get('subagents') as SubagentLike | undefined
    if (!subagents) return false
    try {
      const routingPolicy = ctx.get('evolutionPolicy') as {
        get(): { memoryReviewModel: string; skillReviewModel: string }
      } | undefined
      const model = kind === 'memory'
        ? routingPolicy?.get().memoryReviewModel ?? 'deepseek-v4-flash'
        : routingPolicy?.get().skillReviewModel ?? 'deepseek-v4-pro'
      const run = await subagents.start('spawn', {
        label: 'dsh-evolution-review',
        prompt: [{ type: 'text', text: buildReviewRequest(session, kind, signal as { toolCalls: number; userChars: number; assistantChars: number }) }],
        parent: agent,
        signal: AbortSignal.timeout(120_000),
        maxDepth: 0,
        agentOptions: { provider: 'deepseek-official', model },
        persona: reviewPrompt(kind),
        toolFilter: { allow: [...config.reviewToolAllow] },
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
      const snapshot = policy()
      const validation = validateEvolutionPlan(result.structured as EvolutionPlan, {
        sessionSeq: session.seq - 1,
        maxOpsPerPlan: snapshot?.maxOpsPerPlan ?? 32,
        protectedSkillNames: new Set(snapshot?.protectedSkillNames ?? []),
        maxMemoryChars: snapshot?.memoryChars ?? 2200,
        maxSkillContentChars: snapshot?.skillContentChars ?? 100_000,
      })
      const actions = await executePlan(validation.accepted, agent)
      session.append('evolution/plan-applied', {
        planId: randomUUID(),
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
    const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
    const actions: string[] = []
    for (const op of plan.memoryOps ?? []) {
      if (!Array.isArray(op.evidence) || op.evidence.length === 0) continue
      const target: 'memory' | 'user' = op.target === 'user' ? 'user' : 'memory'
      const normalized = { target, action: op.action ?? 'add', facts: op.facts ?? op.content, old_text: op.old_text }
      const result = approval
        ? await runApproved('memory', `memory ${normalized.target} ${normalized.action}`, normalized, normalized)
        : await memory?.applyBatch(normalized.target, [normalized])
      if (result?.ok) actions.push('Memory updated')
    }
    for (const op of plan.skillOps ?? []) {
      if (!Array.isArray(op.evidence) || op.evidence.length === 0 || !op.name) continue
      const args = { ...op, evidence: op.evidence }
      const result = approval
        ? await runApproved('skill', `skill ${op.action ?? 'patch'} ${op.name}`, { operation: args, origin: 'background_review' }, args)
        : await executeSkillTool(parent, args)
      if (result?.ok) actions.push(`Skill ${op.name} ${op.action ?? 'patch'}`)
    }
    return actions

    async function runApproved(kind: 'memory' | 'skill', summary: string, stored: unknown, runnerArgs: unknown): Promise<{ ok: boolean; message: string } | undefined> {
      if (!approval) return undefined
      const decision = await approval.request({ kind, summary, args: stored, origin: 'background_review' })
      if (decision.action === 'staged') return { ok: false, message: decision.message }
      return await approval.run(kind, runnerArgs)
    }

    async function executeSkillTool(agent: import('@deepseek-ai/dsh-agent').Agent, args: unknown): Promise<{ ok: boolean; message: string }> {
      const result = await ctx.tools.execute({
        callId: CallId(`evolution-${randomUUID()}`),
        name: 'skill_manage',
        arguments: args,
        agent,
        signal: AbortSignal.timeout(30_000),
      })
      return result.isError ? { ok: false, message: 'skill_manage execution failed' } : { ok: true, message: 'skill_manage executed' }
    }
  }

  ctx.effect(() => () => {
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
