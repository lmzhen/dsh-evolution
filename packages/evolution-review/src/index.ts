/**
 * Background review orchestration: signal gate → one-shot subagent → trusted plan execution.
 * @module @deepseek-ai/dsh-evolution-review
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalLike } from '@deepseek-ai/dsh-evolution-approval'
import { createHash, randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import { advanceReview, evolutionIoAdapter, foldTurn, resolveOrigins, SkillLibrary, type EvolutionIoLike, type ReviewKind, type ReviewState } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-state'
import { PROMPT_BUNDLE, reviewPrompt, verifyPromptBundle, COMPLETION_SKILL_REVIEW_PROMPT, DEFAULT_MAX_OPS_PER_PLAN, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_REVIEW_MEMORY_INTERVAL, DEFAULT_REVIEW_SKILL_INTERVAL, DEFAULT_SKILL_CONTENT_CHARS, DEFAULT_SKILL_REVIEW_TRIGGER, DEFAULT_SKILL_REVIEW_COMPLETION_MIN_TOOL_CALLS, DEFAULT_USER_CHAR_LIMIT, type WriteOrigin } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-core'
import { validateEvolutionPlan, type EvolutionPlan, type SkillOp } from '@deepseek-ai/dsh-evolution-plan-validator'
import { redactSecrets as redactReviewSecrets } from '@deepseek-ai/dsh-evolution-core'
import type { PolicySnapshot } from '@deepseek-ai/dsh-evolution-policy'

export const name = 'evolution-review'
export const inject = ['agents']

export interface Config {
  reviewEnabled?: boolean
  reviewMode?: 'subagent' | 'inject'
  memoryInterval?: number
  skillInterval?: number
  /**
   * Tools the one-shot review subagent may use. Only actually-existing tools
   * may be listed (the DSH tool catalog has `skill`; the `skill_search` /
   * `skill_load` discovery pair does not exist on this platform).
   */
  reviewToolAllow?: string[]
  reviewTimeoutMs?: number
  executionTimeoutMs?: number
  reviewContextMessages?: number
  reviewMessageChars?: number
  /** ABSOLUTE cap of the review subagent's own delegation depth (platform
   * resolveChildDepth: childDepth = parentDepth+1 must be <= maxDepth).
   * 1 permits the subagent itself and denies nesting (2 > 1); 0 rejects the
   * spawn outright (SubagentDepthError on any real run — the 0.3.1 defect). */
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
  reviewMode: z.union([z.const('subagent'), z.const('inject')]).default('subagent'),
  memoryInterval: z.number().default(DEFAULT_REVIEW_MEMORY_INTERVAL),
  skillInterval: z.number().default(DEFAULT_REVIEW_SKILL_INTERVAL),
  reviewToolAllow: z.array(z.string()).default(['skill']),
  reviewTimeoutMs: z.number().default(120_000),
  executionTimeoutMs: z.number().default(30_000),
  reviewContextMessages: z.number().default(60),
  reviewMessageChars: z.number().default(2000),
  reviewMaxDepth: z.number().default(1),
  // (rc.66 note) schemastery fields are optional by default — the interface
  // `reviewProvider?` and this schema agree; "Omit to inherit" holds.
  reviewProvider: z.string(),
  skillReviewTrigger: z.string().default(DEFAULT_SKILL_REVIEW_TRIGGER),
  skillReviewCompletionMinToolCalls: z.number().default(DEFAULT_SKILL_REVIEW_COMPLETION_MIN_TOOL_CALLS),
})

interface SubagentLike {
  start(name: string, request: unknown): Promise<{
    result: Promise<{ structured?: unknown }>
    dispose(): Promise<void>
    /** The published in-process child when the provider runs locally (own session). */
    localAgent?: { session: Session }
  }>
}

interface MemoryLike {
  applyBatch(target: 'memory' | 'user', operations: unknown[]): Promise<{ ok: boolean; message: string }>
}

// 0.3.19 (W1.2): ApprovalLike is imported from evolution-approval (the one
// authoritative consumer shape) instead of this local view.

// G4.5 (F-209): the evolution-state service is optional. When it is absent the
// memory/skill cadence state is not persisted and every turn restarts from a
// clean baseline — a silent "memory/skill review never adapts across turns".
// Surface the loss ONCE per process (a per-turn warn on an intentionally
// stateless deployment is noise).
let statelessReviewStateWarned = false

export function apply(ctx: Context, rawConfig: Config): void {
  if (!verifyPromptBundle(PROMPT_BUNDLE)) {
    throw new Error('dsh-evolution prompt bundle integrity check failed; refusing to schedule review work')
  }
  const config = rawConfig as Required<Config>
  const turnStarts = new Map<SessionId, number>()
  // Completion-channel state (E-59f): these two are deliberately NOT persisted
  // to ReviewState. A process restart resets the "session is proven-long"
  // counter and the "completion already injected" flag — which is ACCEPTED:
  // the completion review is a one-per-session post-task adaptation, and a
  // restart is a fresh conversation boundary. The cadence state (turnsSince*)
  // is persisted via ReviewState; the completion channel is a lighter, lossy
  // signal whose cost of losing (a deferred review) is lower than the cost of
  // widening the on-disk record contract.
  const cumulativeToolCalls = new Map<SessionId, number>()
  const completionInjected = new Set<SessionId>()
  // 0.3.18 (E-19): ONE in-flight review subagent process-wide. The shared
  // skill tree and memory have no cross-writer mutex, so two overlapping
  // reviews (a 120s window is long) could fuzzyPatch the same file
  // concurrently. While set, turn/end signals still accumulate (state was
  // already advanced above) but never spawn a second subagent.
  let reviewInFlight = false
  const policy = () => (ctx.get('evolutionPolicy') as { get(): PolicySnapshot } | undefined)?.get()

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') turnStarts.set(session.id, session.seq - 1)
    if (event.type !== 'turn/end') return
    // Counter sweep (rc.42 audit P1-10): the per-session maps grow with every
    // session that ever emitted a turn event, and the platform has no
    // in-process session-end hook to prune against (skill §15). Under size
    // pressure, drop entries whose agent is gone — they can never be read
    // again; live sessions keep their counters.
    const sweepDue = turnStarts.size >= COUNTER_SWEEP_THRESHOLD
      || cumulativeToolCalls.size >= COUNTER_SWEEP_THRESHOLD
      || completionInjected.size >= COUNTER_SWEEP_THRESHOLD
    if (sweepDue) {
      const isAlive = (id: SessionId): boolean => ctx.agents.get(id) !== undefined
      sweepDeadSessionEntries(turnStarts, isAlive)
      sweepDeadSessionEntries(cumulativeToolCalls, isAlive)
      sweepDeadSessionEntries(completionInjected, isAlive)
    }
    void onTurnEnd(session, event)
  })

  async function onTurnEnd(session: Session, event: SessionEvent<'turn/end'>): Promise<void> {
    // 0.3.18 (E-6): the listener is fire-and-forget (`void`), so EVERYTHING
    // below — state load/save, policy, cadence, the subagent start — must be
    // self-contained. A throw here would surface as an unhandled rejection
    // (the state service is an optional service; its failure used to crash
    // the turn). Catch, log, emit review-error, never propagate.
    try {
      await runOnTurnEnd(session, event)
    } catch (error) {
      ctx.logger.warn(`dsh-evolution-review: turn-end review pipeline failed: ${error instanceof Error ? error.message : String(error)}`)
      ctx.emit('evolution/review-error', { sessionId: session.id })
    }
  }

  async function runOnTurnEnd(session: Session, event: SessionEvent<'turn/end'>): Promise<void> {
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
    if (!stateService && !statelessReviewStateWarned) {
      statelessReviewStateWarned = true
      ctx.logger.warn('dsh-evolution-review: evolution-state service not mounted — memory/skill review cadence is not persisted and resets every turn (see README Known Limitations).')
    }
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
      // E-41: run the subagent FIRST, then confirm the schedule. review-scheduled
      // is only emitted after a review actually started (and returned a plan);
      // the inject fallback path (no subagent, or a subagent that yielded no
      // structured plan) does NOT emit it — that signal now means "a review ran".
      const started = await trySubagentReview(session, agent, kind, signal)
      if (started) {
        // Process event, payload v2 (sessionId) — never session.append: a
        // session log carrying evolution/* types is refused wholesale at resume
        // (assertEventsSupported; see core/events.ts for the full rationale).
        ctx.emit('evolution/review-scheduled', {
          sessionId: session.id,
          kind,
          toolCalls: signal.toolCalls,
          userChars: signal.userChars,
          assistantChars: signal.assistantChars,
        })
      } else {
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
    agent.inject(createUserMessage({
      content: [{ type: 'text', text: COMPLETION_SKILL_REVIEW_PROMPT }],
      source: { kind: 'plugin', plugin: 'dsh-evolution-review', form: 'notice', summary: 'completion review' },
    }))
    // G4.4 (F-334): emit the schedule confirmation only after the completion
    // review inject actually dispatches (E-41 ordering: record-schedule once the
    // review was truly sent, not before a dispatch that may fail).
    ctx.emit('evolution/review-scheduled', {
      sessionId: session.id,
      kind: 'skill',
      toolCalls: signal.toolCalls,
      userChars: signal.userChars,
      assistantChars: signal.assistantChars,
    })
  }

  async function trySubagentReview(session: Session, agent: import('@deepseek-ai/dsh-agent').Agent, kind: ReviewKind, signal: unknown): Promise<boolean> {
    if ((policy()?.reviewMode ?? config.reviewMode) === 'inject') return false
    const subagents = ctx.get('subagents') as SubagentLike | undefined
    if (!subagents) return false
    // 0.3.18 (E-19) single-flight: another review is running (the window can
    // be 120s). The caller injects the review prompt instead — the review
    // still happens on THIS turn, just never concurrently with a subagent.
    if (reviewInFlight) return false
    reviewInFlight = true
    try {
      // One authoritative policy read (E-57): the former PolicyLike view and
      // the inline memory/skill model table disagreed with each other; both
      // now come from the single PolicySnapshot type. The policy is immutable
      // for the life of the process, so a single read is valid after the run.
      const snapshot = policy()
      const model = kind === 'memory'
        ? snapshot?.memoryReviewModel ?? 'deepseek-v4-flash'
        : snapshot?.skillReviewModel ?? 'deepseek-v4-pro'
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
        // M-2 (v3 audit): the subagent channel mounts only the read-only
        // `skill` tool — the plan variant of the persona states the channel
        // limit (deliverable = plan, never narrated actions) instead of the
        // operative wording that contradicts the tool filter.
        persona: reviewPrompt(kind, 'plan'),
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
      // Read-before-write must see what the REVIEW subagent itself loaded: it
      // runs in its own session, and the parent session's events never contain
      // its `skill` calls. Read the child session after the run settles, while
      // the try/finally below still owns it (the disposer runs in the finally,
      // so capture MUST precede every disposal path).
      // Everything after start() sits in a try/finally so the child run is
      // disposed on every exit path (success, timeout, validation throw).
      try {
        const result = await run.result
        if (!result.structured) {
          // E-59c: a started subagent that produced no structured plan is NOT a
          // success — the review never happened, so surface review-error and
          // fall through to the synchronous inject path (caller sees false).
          ctx.emit('evolution/review-error', { sessionId: session.id })
          ctx.logger.warn('dsh-evolution-review: review subagent returned no structured plan')
          return false
        }
        // v3-round self-check: collect AFTER the subagent finished so its own
        // `skill` reads are visible to read-before-write (session events of
        // the child never reach the parent; the child session must be read
        // before dispose).
        const childReads = run.localAgent ? collectReadSkillNames(run.localAgent.session) : new Set<string>()
        const plan: unknown = result.structured
        const policyFingerprint = fingerprintPolicy(snapshot)
        const validation = validateEvolutionPlan(plan as EvolutionPlan, {
          sessionSeq: session.seq - 1,
          maxOpsPerPlan: snapshot?.maxOpsPerPlan ?? DEFAULT_MAX_OPS_PER_PLAN,
          protectedSkillNames: new Set(snapshot?.protectedSkillNames ?? []),
          maxMemoryChars: snapshot?.memoryChars ?? DEFAULT_MEMORY_CHAR_LIMIT,
          maxUserChars: snapshot?.userChars ?? DEFAULT_USER_CHAR_LIMIT,
          maxSkillContentChars: snapshot?.skillContentChars ?? DEFAULT_SKILL_CONTENT_CHARS,
        })
        // F19: the background review may only patch skills it read this session
        // (read-before-write, matching the original Hermes background guard).
        // Union of the PARENT session's reads and the review SUBAGENT's own reads.
        const acceptedSkillOps = validation.accepted.skillOps ?? []
        const readNames = new Set<string>([...collectReadSkillNames(session), ...childReads])
        const skippedUnread = filterUnreadSkillOps(acceptedSkillOps, readNames)
        const executed = await executePlan(validation.accepted, session.id)
        const actions = executed.actions
        const evidenceQuotes = [...validation.accepted.memoryOps ?? [], ...acceptedSkillOps]
          .reduce((total, op) => total + (Array.isArray(op.evidence) ? op.evidence.length : 0), 0)
        if (actions.length > 0) {
          const applied = actions.join(' · ')
          // E-59d: on partial failure the model must know which ops already
          // landed so it does not repeat them; the applied list stays explicit.
          const note = executed.ok ? '' : '\n部分操作失败。以下操作已应用，请勿重复执行。'
          // G4.4 (F-334): the result-notice inject is NOT a review-failure — the
          // plan already landed in memory/skill, so a notification error must not
          // fall through to the outer "review failed" catch and flip started to
          // false (which would re-trigger a review inject → double review). Log
          // and continue; the durable plan-applied emit below still records the
          // execution truth.
          try {
            agent.inject(createUserMessage({
              content: [{ type: 'text', text: `💾 Self-improvement review: ${applied}${note}` }],
              source: { kind: 'plugin', plugin: 'dsh-evolution-review', form: 'notice', summary: 'self-improvement review' },
            }))
          } catch (injectError) {
            ctx.logger.warn(`dsh-evolution-review: result notice inject failed: ${injectError instanceof Error ? injectError.message : String(injectError)}`)
          }
        }
        // Process event, payload v2 (sessionId) — plan-outcome durability is the
        // evolution-activity store's job; the session log stays native-only.
        // Emitted AFTER the result-notice inject (E-41 ordering: record the
        // outcome only once the model was told what landed).
        ctx.emit('evolution/plan-applied', {
          sessionId: session.id,
          planId: randomUUID(),
          policyFingerprint,
          memoryApplied: actions.filter(action => action.startsWith('Memory')).length,
          skillApplied: actions.filter(action => action.startsWith('Skill ')).length,
          rejectedOps: validation.rejected.length + skippedUnread,
          evidenceQuotes,
          estimatedInputChars: reviewText.length,
        })
        return true
      } finally {
        // Dispose on EVERY exit (rc.42 audit P1-3): a timed-out / aborted run
        // (result rejects via the start signal) previously skipped dispose and
        // leaked the child session. Dispose failures stay observable without
        // masking the pipeline error that caused the exit.
        try {
          await run.dispose()
        } catch (disposeError) {
          ctx.logger.warn(`dsh-evolution-review: subagent dispose failed: ${disposeError instanceof Error ? disposeError.message : String(disposeError)}`)
        }
      }
    } catch (error) {
      // A review pipeline failure must not crash the turn, but it should be
      // visible. Log the reason so a silent "review never fires" is debuggable,
      // and fall through to the synchronous inject path (caller returns false).
      ctx.logger.warn(`dsh-evolution-review: subagent review failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    } finally {
      reviewInFlight = false
    }
  }

  async function executePlan(plan: EvolutionPlan, sessionId?: string): Promise<{ actions: string[]; ok: boolean }> {
    const memory = ctx.get('memory') as MemoryLike | undefined
    const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
    // The review pipeline IS the review channel on both surfaces (rc.44 M2-2.3).
    const origins = resolveOrigins(undefined, true)
    const actions: string[] = []
    let ok = true
    for (const op of plan.memoryOps ?? []) {
      if (!Array.isArray(op.evidence) || op.evidence.length === 0) continue
      const target: 'memory' | 'user' = op.target === 'user' ? 'user' : 'memory'
      const normalized = { target, action: op.action ?? 'add', facts: op.facts ?? op.content, old_text: op.old_text }
      const result = approval
        ? await runApproved('memory', `memory ${normalized.target} ${normalized.action}`, normalized, normalized)
        : await memory?.applyBatch(normalized.target, [normalized])
      if (result?.ok) actions.push('Memory updated')
      else ok = false
    }
    for (const op of plan.skillOps ?? []) {
      if (!Array.isArray(op.evidence) || op.evidence.length === 0 || !op.name) continue
      const args = { ...op, evidence: op.evidence }
      // The registered skill runner expects the { operation, origin } wrapper;
      // passing it on both the pending record and the replay keeps the
      // background_review origin in the approval-disabled (default) path too.
      const runnerArgs = { operation: args, origin: origins.library }
      const result = approval
        ? await runApproved('skill', `skill ${op.action ?? 'patch'} ${op.name}`, runnerArgs, runnerArgs)
        : await executeSkillDirect(args)
      if (result?.ok) actions.push(`Skill ${op.name} ${op.action ?? 'patch'}`)
      else ok = false
    }
    return { actions, ok }

    async function runApproved(kind: 'memory' | 'skill', summary: string, stored: unknown, runnerArgs: unknown): Promise<{ ok: boolean; message: string } | undefined> {      if (!approval) return undefined
      // P1-9 pre-check: with approval ENABLED but no registered runner for
      // this kind (host-only compositions mount no tool runners), staging
      // would create a pending record that no approver could ever replay.
      // Enabled approval is an explicit operator gate on autonomous writes -
      // with no runner there is no approval path, so the write is REFUSED
      // (fail closed) rather than staged or silently executed. It becomes
      // answerable again as soon as a tool that registers the runner mounts.
      if (approval.isEnabled === true && !approval.hasRunner(kind)) {
        ctx.logger.warn(`dsh-evolution-review: approval enabled but no replay runner registered for kind "${kind}" - skipping write (${summary})`)
        return { ok: false, message: `Approval is enabled but no replay runner is registered for kind "${kind}"; write skipped (mount the tool that provides it, or disable approval).` }
      }
      const decision = await approval.request({ kind, summary, args: stored, origin: origins.approval, ...sessionId ? { sessionId } : {} })
      if (decision.action === 'staged') return { ok: false, message: decision.message }
      // The staged service is mounted but DISABLED (the default deployment),
      // and host-only compositions mount no tool runners — replaying would
      // return "No replay runner registered" for every op. Execute directly
      // with the explicit background_review origin instead.
      if (approval.isEnabled === false) return await runnerDirect(kind, runnerArgs)
      // 0.3.17 (S3.2): the replay channel requires the declared background
      // review intent.
      return await approval.run(kind, runnerArgs, { interface: 'background_review' })
    }

    /** Direct execution for the approval-disabled case (parallel to executeSkillDirect). */
    async function runnerDirect(kind: 'memory' | 'skill', args: unknown): Promise<{ ok: boolean; message: string } | undefined> {
      if (kind === 'memory') {
        const memory = ctx.get('memory') as { applyBatch?(target: 'memory' | 'user', ops: unknown[]): Promise<{ ok: boolean; message: string }> } | undefined
        const op = args as { target?: string; action?: string; facts?: string; content?: string; old_text?: string }
        if (!memory?.applyBatch) return undefined
        return await memory.applyBatch(op.target === 'user' ? 'user' : 'memory', [
          { action: op.action ?? 'add', facts: op.facts ?? op.content, old_text: op.old_text },
        ])
      }
      const wrapped = (args ?? {}) as { operation?: SkillOp }
      if (!wrapped.operation) return undefined
      return await executeSkillDirect(wrapped.operation)
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
      const library = new SkillLibrary(undefined, evolutionIoAdapter(() => io.provider()), undefined, (event) => { ctx.emit('evolution/skill-mutated', event) })
      const op = skillArgs
      const name = op.name ?? ''
      const origin: WriteOrigin = origins.library
      if (op.action === 'create') {
        // The direct path (approval-disabled deployments) must keep the same
        // lifecycle entry as the runner: an agent-created record so the
        // curator actually manages the skill.
        const created = await library.create(name, op.content ?? '', origin)
        if (created.ok) {
          const usageRegistry = ctx.get('skillUsage') as { markAgentCreated?(name: string): Promise<void> } | undefined
          await usageRegistry?.markAgentCreated?.(name)
        }
        return created
      }
      if (op.action === 'edit' || op.action === 'update') return await library.update(name, op.content ?? '', origin)
      if (op.action === 'patch') return await library.patch(name, op.old_string ?? '', op.new_string ?? '', op.file_path ?? '', false, origin)
      if (op.action === 'delete') {
        const into = (op.absorbed_into ?? '').trim()
        if (!into || !(await library.read(into))) {
          return { ok: false, message: 'delete requires an existing absorbed_into target' }
        }
        const archived = await library.archive(name, { absorbedInto: into })
        if (archived.ok) {
          // The direct path (approval-disabled deployments) must keep the same
          // lifecycle state as the runner: archiving is a state transition,
          // and without markArchived the usage record stays active/stale so
          // every later curator run treats the missing directory as a
          // candidate and errors forever (rc.39 audit §4-A).
          const usageRegistry = ctx.get('skillUsage') as { markArchived?(name: string): Promise<void> } | undefined
          await usageRegistry?.markArchived?.(name)
        }
        return archived
      }
      if (op.action === 'write_file') return await library.writeSupportFile(name, op.file_path ?? '', op.file_content ?? op.content ?? '', origin)
      if (op.action === 'remove_file') return await library.removeSupportFile(name, op.file_path ?? '', origin)
      if (op.action === 'restructure') {
        const moves = (op.restructure ?? [])
          .filter((move): move is { heading?: string; to_file?: string } => move !== null)
          .map(move => ({ heading: move.heading ?? '', toFile: move.to_file ?? '' }))
        return await library.restructure(name, moves, origin)
      }
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

/** Skill names this session loaded (read-before-write source for the background review).
 * Only the real `skill` tool is a read (E-59e): the platform has no `skill_load`/
 * `skill_search` discovery pair, so that branch was dead. `skill_manage` has no
 * per-skill read action (its `list`/`review` are whole-library), so a specific
 * skill read through it cannot be tracked — see README Known Limitations. */
function collectReadSkillNames(session: Session): Set<string> {
  const names = new Set<string>()
  for (const event of session.events) {
    if (event.type !== 'tool/call') continue
    if (event.data.name !== 'skill') continue
    const raw = (event.data as unknown as { arguments?: string | Record<string, unknown> }).arguments
    let parsed: unknown = {}
    if (typeof raw === 'string') {
      try {
        // F-203 (0.3.23): `JSON.parse('null')` yields null; guard before `.name`.
        parsed = JSON.parse(raw) as unknown
      } catch {
        continue
      }
    } else {
      parsed = raw ?? {}
    }
    const parsedObj = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
    const name = typeof parsedObj.name === 'string' ? parsedObj.name : typeof parsedObj.skill === 'string' ? parsedObj.skill : ''
    if (name) names.add(name)
  }
  return names
}

/** Map/set size that triggers a dead-session counter sweep (bounded, not a hard cap). */
const COUNTER_SWEEP_THRESHOLD = 128

/**
 * Remove every entry whose session is no longer live (rc.42 audit P1-10):
 * `turnStarts` / `cumulativeToolCalls` / `completionInjected` are keyed by
 * SessionId with no platform session-end hook to prune against, so they grew
 * unbounded over a long-lived host. Works for maps and sets; returns the
 * number of removed entries.
 */
export function sweepDeadSessionEntries<K>(entries: Map<K, unknown> | Set<K>, isAlive: (id: K) => boolean): number {
  let removed = 0
  for (const id of [...entries.keys()]) {
    if (!isAlive(id)) {
      entries.delete(id)
      removed += 1
    }
  }
  return removed
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
  const READ_REQUIRED = ['edit', 'update', 'patch', 'delete', 'write_file', 'remove_file', 'restructure']
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
  // Tool evidence — the review subagent cannot verify a plan against command
  // output it never saw, so append recent tool calls and results as structured
  // lines (budgeted: truncated per event, and capped to the last 12 events).
  const toolLines: string[] = []
  const events = session.events
  for (let index = events.length - 1; index >= 0 && toolLines.length < 12; index -= 1) {
    const event = events[index] as { type?: string; data?: unknown } | undefined
    if (event?.type === 'tool/call') {
      const data = event.data as { name?: string; arguments?: string | Record<string, unknown> } | undefined
      const argsRaw = typeof data?.arguments === 'string' ? data.arguments : JSON.stringify(data?.arguments ?? {})
      toolLines.push(`[call] ${data?.name ?? '?'} ${argsRaw.slice(0, 500)}`)
    } else if (event?.type === 'tool/result') {
      const data = event.data as { error?: unknown; output?: string } | undefined
      const output = typeof data?.output === 'string' ? data.output : ''
      const failure = data?.error ? ' [ERROR]' : ''
      toolLines.push(`[result]${failure} ${output.slice(0, 500)}`)
    }
  }
  toolLines.reverse()
  return [
    `Review kind: ${kind}`,
    `Signals: ${signal.toolCalls} tool calls, ${signal.userChars} user chars, ${signal.assistantChars} assistant chars.`,
    `Recent tool activity (${toolLines.length}):`,
    ...toolLines,
    'Return ONLY the structured JSON plan. Evidence is mandatory for every op.',
    '',
    ...messages,
  ].join('\n')
}
