/**
 * Background review orchestration: signal gate → one-shot subagent → trusted plan execution.
 * @module @deepseek-ai/dsh-evolution-review
 */

import type { Context } from '@deepseek-ai/cordis'
import { createHash, randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import { advanceReview, evolutionIoAdapter, foldTurn, SkillLibrary, type EvolutionIoLike, type ReviewKind, type ReviewState } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-state'
import { PROMPT_BUNDLE, reviewPrompt, verifyPromptBundle, COMPLETION_SKILL_REVIEW_PROMPT, DEFAULT_REVIEW_MEMORY_INTERVAL, DEFAULT_REVIEW_SKILL_INTERVAL, DEFAULT_SKILL_REVIEW_TRIGGER, DEFAULT_SKILL_REVIEW_COMPLETION_MIN_TOOL_CALLS, type WriteOrigin } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-core'
import { validateEvolutionPlan, type SkillOp } from '@deepseek-ai/dsh-evolution-plan-validator'
import { redactReviewSecrets } from './redact.ts'

export const name = 'evolution-review'
export const inject = ['agents', 'tools']

export interface Config {
  reviewEnabled?: boolean
  reviewMode?: string
  memoryInterval?: number
  skillInterval?: number
  /** Tools the one-shot review subagent may use. Defaults include the Anchored Standard discovery pair. */
  reviewToolAllow?: string[]
  reviewTimeoutMs?: number
  executionTimeoutMs?: number
  reviewContextMessages?: number
  reviewMessageChars?: number
  reviewMaxDepth?: number
  /** LLM provider for review subagents. Omit to inherit the deployment default route. */
  reviewProvider?: string
  /** Skill-review trigger: cadence (interval) | completion (once after a proven-long task) | both. */
  skillReviewTrigger?: string
  /** Cumulative session tool calls before a session counts as proven-long for the completion channel. */
  skillReviewCompletionMinToolCalls?: number
}

export const Config: z<Config> = z.object({
  reviewEnabled: z.boolean().default(true),
  reviewMode: z.string().default('subagent'),
  memoryInterval: z.number().default(DEFAULT_REVIEW_MEMORY_INTERVAL),
  skillInterval: z.number().default(DEFAULT_REVIEW_SKILL_INTERVAL),
  reviewToolAllow: z.array(z.string()).default(['skill', 'skill_search', 'skill_load']),
  reviewTimeoutMs: z.number().default(120_000),
  executionTimeoutMs: z.number().default(30_000),
  reviewContextMessages: z.number().default(60),
  reviewMessageChars: z.number().default(2000),
  reviewMaxDepth: z.number().default(0),
  reviewProvider: z.string(),
  skillReviewTrigger: z.string().default(DEFAULT_SKILL_REVIEW_TRIGGER),
  skillReviewCompletionMinToolCalls: z.number().default(DEFAULT_SKILL_REVIEW_COMPLETION_MIN_TOOL_CALLS),
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
  request(input: { kind: 'memory' | 'skill'; summary: string; args: unknown; origin: WriteOrigin }): Promise<{ action: 'allow' | 'staged'; pendingId?: string; message: string }>
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
    userChars: number
    skillContentChars: number
  }
}

export function apply(ctx: Context, rawConfig: Config): void {
  if (!verifyPromptBundle(PROMPT_BUNDLE)) {
    throw new Error('dsh-evolution prompt bundle integrity check failed; refusing to schedule review work')
  }
  const config = rawConfig as Required<Config>
  const turnStarts = new Map<SessionId, number>()
  const cumulativeToolCalls = new Map<SessionId, number>()
  const completionInjected = new Set<SessionId>()
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
    // Cumulative tool-call counter updates on EVERY turn/end — including turns
    // that fired a cadence review — so the completion channel's long-session
    // gate reflects the whole conversation, not only cadence-free turns.
    const cumulative = (cumulativeToolCalls.get(session.id) ?? 0) + signal.toolCalls
    cumulativeToolCalls.set(session.id, cumulative)
    if (kind) {
      session.append('evolution/review-scheduled', {
        kind,
        toolCalls: signal.toolCalls,
        userChars: signal.userChars,
        assistantChars: signal.assistantChars,
      })
      const started = await trySubagentReview(session, agent, kind, signal)
      if (!started) {
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: reviewPrompt(kind) }],
          source: { kind: 'plugin', plugin: 'dsh-evolution-review', form: 'notice', summary: 'auto-review' },
        }))
      }
      return
    }
    // Cadence waited; the completion channel fires once per session after a
    // task the conversation has proven long (cumulative tool-call threshold),
    // so short conversations are never adapted to at the cost of long ones.
    const trigger = config.skillReviewTrigger
    if (trigger !== 'completion' && trigger !== 'both') return
    if (completionInjected.has(session.id)) return
    if (!shouldCompletionReview(event.data.reason, cumulative, config.skillReviewCompletionMinToolCalls)) return
    completionInjected.add(session.id)
    session.append('evolution/review-scheduled', {
      kind: 'skill',
      toolCalls: signal.toolCalls,
      userChars: signal.userChars,
      assistantChars: signal.assistantChars,
    })
    agent.inject(createUserMessage({
      content: [{ type: 'text', text: COMPLETION_SKILL_REVIEW_PROMPT }],
      source: { kind: 'plugin', plugin: 'dsh-evolution-review', form: 'notice', summary: 'completion review' },
    }))
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
      const reviewText = redactReviewSecrets(buildReviewRequest(
        session,
        kind,
        signal as { toolCalls: number; userChars: number; assistantChars: number },
        config.reviewContextMessages,
        config.reviewMessageChars,
      ))
      const agentOptions: Record<string, string> = { model }
      if (config.reviewProvider) agentOptions.provider = config.reviewProvider
      const run = await subagents.start('spawn', {
        label: 'dsh-evolution-review',
        prompt: [{ type: 'text', text: reviewText }],
        parent: agent,
        signal: AbortSignal.timeout(config.reviewTimeoutMs),
        maxDepth: config.reviewMaxDepth,
        agentOptions,
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
      const plan: unknown = result.structured
      const policyFingerprint = fingerprintPolicy(snapshot)
      const validation = validateEvolutionPlan(plan as EvolutionPlan, {
        sessionSeq: session.seq - 1,
        maxOpsPerPlan: snapshot?.maxOpsPerPlan ?? 32,
        protectedSkillNames: new Set(snapshot?.protectedSkillNames ?? []),
        maxMemoryChars: snapshot?.memoryChars ?? 2200,
        maxUserChars: snapshot?.userChars ?? 1375,
        maxSkillContentChars: snapshot?.skillContentChars ?? 100_000,
      })
      // F19: the background review may only patch skills it read this session
      // (read-before-write, matching the original Hermes background guard).
      const acceptedSkillOps = validation.accepted.skillOps ?? []
      const skippedUnread = filterUnreadSkillOps(acceptedSkillOps, collectReadSkillNames(session))
      validation.accepted.skillOps = acceptedSkillOps
      const actions = await executePlan(validation.accepted)
      const evidenceQuotes = [...validation.accepted.memoryOps ?? [], ...acceptedSkillOps]
        .reduce((total, op) => total + (Array.isArray(op.evidence) ? op.evidence.length : 0), 0)
      session.append('evolution/plan-applied', {
        planId: randomUUID(),
        policyFingerprint,
        memoryApplied: actions.filter(action => action.startsWith('Memory')).length,
        skillApplied: actions.filter(action => action.startsWith('Skill ')).length,
        rejectedOps: validation.rejected.length + skippedUnread,
        evidenceQuotes,
        estimatedInputChars: reviewText.length,
      })
      if (actions.length > 0) {
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: `💾 Self-improvement review: ${actions.join(' · ')}` }],
          source: { kind: 'plugin', plugin: 'dsh-evolution-review', form: 'notice', summary: 'self-improvement review' },
        }))
      }
      return true
    } catch (error) {
      // A review pipeline failure must not crash the turn, but it should be
      // visible. Log the reason so a silent "review never fires" is debuggable,
      // and fall through to the synchronous inject path (caller returns false).
      ctx.logger.warn(`dsh-evolution-review: subagent review failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  async function executePlan(plan: EvolutionPlan): Promise<string[]> {
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
      // The registered skill runner expects the { operation, origin } wrapper;
      // passing it on both the pending record and the replay keeps the
      // background_review origin in the approval-disabled (default) path too.
      const runnerArgs = { operation: args, origin: 'background_review' as const }
      const result = approval
        ? await runApproved('skill', `skill ${op.action ?? 'patch'} ${op.name}`, runnerArgs, runnerArgs)
        : await executeSkillDirect(args)
      if (result?.ok) actions.push(`Skill ${op.name} ${op.action ?? 'patch'}`)
    }
    return actions

    async function runApproved(kind: 'memory' | 'skill', summary: string, stored: unknown, runnerArgs: unknown): Promise<{ ok: boolean; message: string } | undefined> {
      if (!approval) return undefined
      const decision = await approval.request({ kind, summary, args: stored, origin: 'background_review' })
      if (decision.action === 'staged') return { ok: false, message: decision.message }
      return await approval.run(kind, runnerArgs)
    }

    /**
     * Approval-disabled path: execute the skill op through SkillLibrary with an
     * EXPLICIT background_review origin. Going through ctx.tools.execute would
     * make tool-skill-manage infer origin from the parent agent's header
     * (not 'subagent'), silently escaping the .hermes-managed marker and the
     * pinned write guard.
     */
    async function executeSkillDirect(skillArgs: SkillOp): Promise<{ ok: boolean; message: string }> {
      const io = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
      if (!io) return { ok: false, message: 'evolution-io service not mounted' }
      const library = new SkillLibrary(undefined, evolutionIoAdapter(() => io.provider()))
      const op = skillArgs
      const name = op.name ?? ''
      const origin: WriteOrigin = 'background_review'
      if (op.action === 'create') return await library.create(name, op.content ?? '', origin)
      if (op.action === 'edit' || op.action === 'update') return await library.update(name, op.content ?? '', origin)
      if (op.action === 'patch') return await library.patch(name, op.old_string ?? '', op.new_string ?? '', op.file_path ?? '', false, origin)
      if (op.action === 'delete') return await library.archive(name, op.absorbed_into ? { absorbedInto: op.absorbed_into } : {})
      if (op.action === 'write_file') return await library.writeSupportFile(name, op.file_path ?? '', op.file_content ?? op.content ?? '', origin)
      if (op.action === 'remove_file') return await library.removeSupportFile(name, op.file_path ?? '', origin)
      return { ok: false, message: `Unknown skill action "${op.action ?? ''}"` }
    }
  }

  ctx.effect(() => () => {
    turnStarts.clear()
    cumulativeToolCalls.clear()
    completionInjected.clear()
  }, 'dsh-evolution-review.cleanup')
}

/** Completion-channel decision: task finished normally AND the session is proven long. */
export function shouldCompletionReview(reason: { kind?: string } | undefined, sessionToolCalls: number, minToolCalls: number): boolean {
  return reason?.kind === 'completed' && sessionToolCalls >= minToolCalls
}

/** Skill names this session loaded (read-before-write source for the background review). */
export function collectReadSkillNames(session: Session): Set<string> {
  const names = new Set<string>()
  for (const event of session.events) {
    if (event.type !== 'tool/call') continue
    if (event.data.name !== 'skill' && event.data.name !== 'skill_load') continue
    const raw = (event.data as unknown as { arguments?: string | Record<string, unknown> }).arguments
    let parsed: Record<string, unknown> = {}
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw) as Record<string, unknown> } catch { continue }
    } else {
      parsed = raw ?? {}
    }
    const name = typeof parsed.name === 'string' ? parsed.name : typeof parsed.skill === 'string' ? parsed.skill : ''
    if (name) names.add(name)
  }
  return names
}

/**
 * Drop mutating ops whose target was not read this session, in place.
 * Create is exempt (no read required to author a new skill). Covers the same
 * mutating surface Hermes guards (edit/patch/write_file/remove_file), so a
 * background review cannot blind-touch support files or edits of skills it
 * never loaded. Returns the count of dropped ops so the plan event can report
 * them as rejected.
 */
export function filterUnreadSkillOps(ops: Array<{ action?: string; name?: string }>, readNames: ReadonlySet<string>): number {
  const READ_REQUIRED = ['edit', 'update', 'patch', 'delete', 'write_file', 'remove_file']
  let dropped = 0
  for (let index = ops.length - 1; index >= 0; index -= 1) {
    const op = ops[index]
    if (!op) continue
    if (op.action !== undefined && READ_REQUIRED.includes(op.action) && op.name && !readNames.has(op.name)) {
      ops.splice(index, 1)
      dropped += 1
    }
  }
  return dropped
}

function fingerprintPolicy(snapshot: unknown): string | undefined {
  try {
    return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 12)
  } catch {
    return undefined
  }
}

function buildReviewRequest(
  session: Session,
  kind: ReviewKind,
  signal: { toolCalls: number; userChars: number; assistantChars: number },
  maxMessages: number,
  maxMessageChars: number,
): string {
  const messages: string[] = []
  const surface = session.deriveMessages()
  for (const message of surface.slice(-maxMessages)) {
    if (message.role === 'user' || message.role === 'assistant') {
      const text = message.content.map(block => block.type === 'text' ? block.text : '').join(' ').trim()
      if (text) messages.push(`${message.role.toUpperCase()}: ${text.slice(0, maxMessageChars)}`)
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
