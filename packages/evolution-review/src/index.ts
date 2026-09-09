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
import { advanceReview, evolutionIoAdapter, foldTurn, resolveOrigins, resolveRootConfig, resolveSkillsRoot, SkillLibrary, type EvolutionIoLike, type ReviewKind, type ReviewState } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-state'
import { PROMPT_BUNDLE, reviewPrompt, verifyPromptBundle, COMPLETION_SKILL_REVIEW_PROMPT, DEFAULT_MAX_OPS_PER_PLAN, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_REVIEW_MEMORY_INTERVAL, DEFAULT_REVIEW_SKILL_INTERVAL, DEFAULT_REVIEW_TIMEOUT_MS, DEFAULT_REVIEW_CONTEXT_MESSAGES, DEFAULT_REVIEW_MESSAGE_CHARS, DEFAULT_SKILL_CONTENT_CHARS, DEFAULT_SKILL_REVIEW_TRIGGER, DEFAULT_SKILL_REVIEW_COMPLETION_MIN_TOOL_CALLS, DEFAULT_USER_CHAR_LIMIT, clampedNumber, type WriteOrigin } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-core'
import { validateEvolutionPlan, type EvolutionPlan, type SkillOp } from '@deepseek-ai/dsh-evolution-plan-validator'
import { redactSecrets as redactReviewSecrets } from '@deepseek-ai/dsh-evolution-core'
import type { PolicySnapshot } from '@deepseek-ai/dsh-evolution-policy'

export const name = 'evolution-review'
export const inject = ['agents']

/** Node's 32-bit timer-delay ceiling (`AbortSignal.timeout`/`setTimeout`):
 * a larger value throws RangeError. B-2 (v18): without a max, a misconfigured
 * `reviewTimeoutMs` made `AbortSignal.timeout` throw inside the subagent
 * start call; the outer catch logged it and silently degraded the review to
 * the inject path. The schema and the assembly clamp both reject it (same
 * bound as commands/maintenance). */
const MAX_TIMER_DELAY_MS = 4_294_967_295

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
  reviewContextMessages?: number
  reviewMessageChars?: number
  /** ABSOLUTE cap of the review subagent's own delegation depth (platform
   * resolveChildDepth: childDepth = parentDepth+1 must be <= maxDepth).
   * 1 permits the subagent itself and denies nesting (2 > 1); 0 rejects the
   * spawn outright (SubagentDepthError on any real run — the 0.3.1 defect). */
  reviewMaxDepth?: number
  /** LLM provider for review subagents. Omit to inherit the deployment default route. */
  reviewProvider?: string
  /** E3/P1-8 (v11) — TRUE semantics: this flag gates ONLY the completion
   * channel. The cadence latch stays active regardless of the value (a
   * completion-gated deployment still fires at the policy cadence), so
   * 'completion' does NOT mean "cadence off", and 'both' is effectively
   * "completion on top of the always-on cadence". The mutually-exclusive
   * channel reading in earlier docs was wrong. */
  skillReviewTrigger?: 'cadence' | 'completion' | 'both'
  /** Cumulative session tool calls before a session counts as proven-long for the completion channel. */
  skillReviewCompletionMinToolCalls?: number
  /** 0.3.40: deliver the deferred review with a WAKING inject for a summary the
   * model starts immediately (agent.followup — same send() queue, wakeup bit
   * differs). Default true; false degrades to the non-waking inject (the
   * summary then waits for the next driver wake). */
  reviewWakeInject?: boolean
  /** V10-11 (P2-7): skill tree root for the review's direct skill writes.
   * Empty (the default) resolves through `resolveSkillsRoot` to the shared
   * default root — the historical behavior. A custom root keeps review-created
   * skills in the SAME tree the catalog/tools read instead of writing a
   * parallel tree the rest of the family cannot see. E-7 (v18): canonical key. */
  root?: string
  /** Deprecated alias of `root` (E-7, v18); honoured only while `root` is
   * empty, with a warning; removed after 0.3.65. */
  skillsRoot?: string
}

export const Config: z<Config> = z.object({
  reviewEnabled: z.boolean().default(true),
  reviewMode: z.union([z.const('subagent'), z.const('inject')]).default('subagent'),
  memoryInterval: z.number().min(1).default(DEFAULT_REVIEW_MEMORY_INTERVAL),
  skillInterval: z.number().min(1).default(DEFAULT_REVIEW_SKILL_INTERVAL),
  reviewToolAllow: z.array(z.string()).default(['skill']),
  reviewTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_REVIEW_TIMEOUT_MS),
  // P3-4 (v14): the former `executionTimeoutMs` declaration was deleted — no
  // code path ever read it, and keeping a configurable-looking dead field in
  // the schema invited deployments to set something with no effect.
  reviewContextMessages: z.number().min(1).default(DEFAULT_REVIEW_CONTEXT_MESSAGES),
  reviewMessageChars: z.number().min(1).default(DEFAULT_REVIEW_MESSAGE_CHARS),
  // reviewMaxDepth 0 is the historical 0.3.1 maximum-depth defect (a 0 rejects
  // the spawn outright), so its min is 1. `reviewTimeoutMs` 0 is not a "no
  // timeout" meaning — AbortSignal.timeout(0) aborts immediately (and there is
  // no disable-timeout branch), so it clamps to at least 1.
  reviewMaxDepth: z.number().min(1).default(1),
  // (rc.66 note) schemastery fields are optional by default — the interface
  // `reviewProvider?` and this schema agree; "Omit to inherit" holds.
  reviewProvider: z.string(),
  // V7-15 (0.3.44): the trigger is closed to the three known values — a typo
  // cannot silently select a fourth behavior. Note: schemastery is tolerant
  // (it STRIPS an unmatching value and keeps the default), so the runtime
  // degradation is silent by design; the union keeps the TYPE surface closed
  // for config authors.
  skillReviewTrigger: z.union([z.const('cadence'), z.const('completion'), z.const('both')]).default(DEFAULT_SKILL_REVIEW_TRIGGER),
  reviewWakeInject: z.boolean().default(true),
  skillReviewCompletionMinToolCalls: z.number().min(1).default(DEFAULT_SKILL_REVIEW_COMPLETION_MIN_TOOL_CALLS),
  // V10-11 (P2-7): empty string keeps the default root (resolveSkillsRoot
  // trims and falls back) — the schema default mirrors the Config contract.
  // E-7 (v18): `root` is canonical; `skillsRoot` is the deprecated alias.
  root: z.string().default(''),
  skillsRoot: z.string().default(''),
})

/** V8-01 (0.3.45): the review subagent's structured-output contract. The
 * `subagents.start` outputSchema is RAW JSON Schema validated by
 * assertObjectJsonSchema (upstream dsh-tools json-schema.ts — SCHEMA_TYPES
 * has no 'json'; 'json' is a defineTool-author DSL-only value). The arrays
 * deliberately use `{ type: 'array' }` with NO items node — absent items
 * accepts any JSON item (upstream semantics, json-schema.ts "Item schema
 * (type: 'array' only); absent accepts any JSON item"), and plan-validator
 * owns the per-op structure proof. The whitelist contract test (review.spec
 * V8-01) forbids a DSL value slipping back in. */
export const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    memoryOps: { type: 'array' },
    skillOps: { type: 'array' },
    summary: { type: 'string' },
  },
} as const

/** V8-01 (0.3.45): the minimal start() request shape the review passes — the
 * OUTPUT SCHEMA part is typed against the raw JSON-Schema subset vocabulary,
 * so a defineTool DSL value like `'json'` fails at the type surface instead
 * of silently rejecting every spawn at runtime (the historical defect the
 * mock-based tests and the previous `unknown` request type could not see). */
interface ReviewOutputSchemaLike {
  type: 'object'
  additionalProperties?: boolean
  properties?: Record<string, {
    type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
    items?: { type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null' }
    properties?: Record<string, { type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null' }>
  }>
}

interface SubagentStartRequestLike {
  label?: string
  prompt?: unknown
  parent?: unknown
  signal?: unknown
  maxDepth?: number
  agentOptions?: Record<string, string>
  persona?: unknown
  toolFilter?: { allow?: string[] }
  outputSchema?: ReviewOutputSchemaLike
  [key: string]: unknown
}

interface SubagentLike {
  start(name: string, request: SubagentStartRequestLike): Promise<{
    result: Promise<{ structured?: unknown }>
    dispose(): Promise<void>
    /** The published in-process child when the provider runs locally (own session). */
    localAgent?: { session: Session }
  }>
}

// P3 (v16): the interface was accidentally declared TWICE (verbatim copies —
// TS declaration merging silently allowed it). Merged back to one. The
// v15 "use the real upstream type" intent stays a documented anchor instead:
// the upstream `SubagentRun.localAgent` type is not importable from the
// mirror's pinned tree, so this structural view remains.
// P2-13 (v15) VERSION ANCHOR: `localAgent` is upstream `SubagentRun.localAgent`
// (subagent/src/types.ts) narrowed from `Agent | undefined` to
// `{ session: Session } | undefined` — we read only `.session`. Upstream
// documents "local runs always carry a session"; if a future upstream allows a
// session-less local handle, this type will NOT catch it (re-verify on every
// upstream bump).
interface MemoryLike {
  applyBatch(target: 'memory' | 'user', operations: unknown[]): Promise<{ ok: boolean; message: string }>
}

// 0.3.19 (W1.2): ApprovalLike is imported from evolution-approval (the one
// authoritative consumer shape) instead of this local view.

// G4.5 (F-209): the evolution-state service is optional. When it is absent the
// memory/skill cadence state is not persisted and every turn restarts from a
// clean baseline — a silent "memory/skill review never adapts across turns".
// P3 (v15): the warn flag moved from module scope into the `apply` closure —
// the module-level one stayed true forever across plugin re-mounts, so a
// re-mounted stateless review was PERMANENTLY silent; per-apply matches the
// curator's per-instance v14 flag (warn once per mount, again after re-mount).
// A per-turn warn on an intentionally stateless deployment is still noise.

/**
 * G3.1 (0.3.23): clamp the numeric review config at assembly so a 0/negative/
 * NaN/±Infinity value falls back to the package default instead of folding as a
 * "disabled" special value (a 0 interval would fire a review every turn; NaN
 * folds as NaN into the cadence/timeout). The schema `.min(1)` guards the
 * loader path; this clamp also covers NaN/±Infinity (which schemastery lets a
 * bare number schema through) and direct construction. `reviewMaxDepth` clamps
 * to at least 1 because 0 is the historical 0.3.1 maximum-depth defect (a 0
 * rejects the spawn outright). Warn once when a user-supplied value had to be
 * corrected.
 */
/** F5 (P2-16, v11): the clamp sets exactly these seven numeric fields — the
 * old `as Required<Config>` lied about `reviewToolAllow` etc. being populated
 * (`[...undefined]` TypeErrors under a direct `apply(ctx, {})`). */
type ClampedReviewConfig = Config & {
  memoryInterval: number
  skillInterval: number
  reviewTimeoutMs: number
  reviewContextMessages: number
  reviewMessageChars: number
  reviewMaxDepth: number
  skillReviewCompletionMinToolCalls: number
}

export function clampReviewConfig(rawConfig: Config, ctx: Context): ClampedReviewConfig {
  const clamped: string[] = []
  const field = (name: keyof Config, value: number | undefined, fallback: number, min: number, max?: number): number => {
    const result = clampedNumber(value, fallback, max === undefined ? { min } : { min, max })
    if (value !== undefined && result !== value) clamped.push(name)
    return result
  }
  const config = Object.assign({}, rawConfig, {
    memoryInterval: field('memoryInterval', rawConfig.memoryInterval, DEFAULT_REVIEW_MEMORY_INTERVAL, 1),
    skillInterval: field('skillInterval', rawConfig.skillInterval, DEFAULT_REVIEW_SKILL_INTERVAL, 1),
    // B-2 (v18): the 32-bit ceiling is enforced here as well as in the schema
    // (the schema may be bypassed by a programmatic assembly; clampedNumber
    // also catches NaN/±Infinity, which z.number() lets through).
    reviewTimeoutMs: field('reviewTimeoutMs', rawConfig.reviewTimeoutMs, DEFAULT_REVIEW_TIMEOUT_MS, 1, MAX_TIMER_DELAY_MS),
    reviewContextMessages: field('reviewContextMessages', rawConfig.reviewContextMessages, DEFAULT_REVIEW_CONTEXT_MESSAGES, 1),
    reviewMessageChars: field('reviewMessageChars', rawConfig.reviewMessageChars, DEFAULT_REVIEW_MESSAGE_CHARS, 1),
    reviewMaxDepth: field('reviewMaxDepth', rawConfig.reviewMaxDepth, 1, 1),
    skillReviewCompletionMinToolCalls: field('skillReviewCompletionMinToolCalls', rawConfig.skillReviewCompletionMinToolCalls, DEFAULT_SKILL_REVIEW_COMPLETION_MIN_TOOL_CALLS, 1),
  })
  if (clamped.length > 0) {
    ctx.logger.warn(`dsh-evolution-review: ${clamped.join(', ')} provided an invalid value; falling back to the default`)
  }
  return config
}

export function apply(ctx: Context, rawConfig: Config = {}): void {
  if (!verifyPromptBundle(PROMPT_BUNDLE)) {
    throw new Error('dsh-evolution prompt bundle integrity check failed; refusing to schedule review work')
  }
  const config = clampReviewConfig(rawConfig, ctx)
  // E-7 (v18): canonical `root`, deprecated `skillsRoot` alias.
  const rootConfig = resolveRootConfig(rawConfig)
  if (rootConfig.usedDeprecatedAlias) {
    ctx.logger.warn('evolution-review: config "skillsRoot" is deprecated (E-7); use "root" — the alias is honoured until 0.3.65')
  }
  const turnStarts = new Map<SessionId, number>()
  // P3 (v15): per-mount one-shot for the stateless warn (was module-level).
  let statelessReviewStateWarned = false
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
  // V6-53 / 0.3.38 (deferred cadence inject): a threshold-deserved review whose
  // subagent path was unavailable is HELD here (last trigger wins — the most
  // recent relevance) and injected at conversation completion instead of
  // interrupting the task (and invalidating the prefix cache from that point
  // on). Same in-memory discipline as the completion channel: a restart is a
  // fresh conversation boundary, and the deferred review is a light loss.
  const pendingCadenceReviews = new Map<SessionId, ReviewKind>()
  const pendingCadenceWarned = new Set<SessionId>()
  // V7-02 (0.3.41): the waking delivery (followup) starts a NEW turn whose
  // only substantive input is our own review prompt — with interval=1 that
  // turn fires cadence again and re-delivers, an unbounded review loop. The
  // delivered turn still accumulates (real user content arriving with it is
  // not lost) but its cadence FIRE is suppressed once; the next real turn
  // re-arms normally. In-memory only: a restart clears the inbox queue, so
  // the loop cannot survive it.
  const skipNextCadenceFire = new Map<SessionId, boolean>()
  // V7-04 (0.3.42): the post-delivery counter reset may fail to persist (state
  // store IO failure) — delivery already happened, so warn once per session
  // about the repeat-review source instead of silently re-delivering forever.
  const cadenceResetWarned = new Set<SessionId>()
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
      || pendingCadenceReviews.size >= COUNTER_SWEEP_THRESHOLD
      || skipNextCadenceFire.size >= COUNTER_SWEEP_THRESHOLD
      || cadenceResetWarned.size >= COUNTER_SWEEP_THRESHOLD
    if (sweepDue) {
      const isAlive = (id: SessionId): boolean => ctx.agents.get(id) !== undefined
      sweepDeadSessionEntries(turnStarts, isAlive)
      sweepDeadSessionEntries(cumulativeToolCalls, isAlive)
      sweepDeadSessionEntries(completionInjected, isAlive)
      sweepDeadSessionEntries(pendingCadenceReviews, isAlive)
      sweepDeadSessionEntries(pendingCadenceWarned, isAlive)
      sweepDeadSessionEntries(skipNextCadenceFire, isAlive)
      sweepDeadSessionEntries(cadenceResetWarned, isAlive)
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
      // V6-23 (0.3.36): the error signal is its own protection domain — a
      // synchronously-throwing listener (cordis emit calls listeners directly)
      // must not replace the original failure with an unhandled rejection.
      try {
        ctx.emit('evolution/review-error', { sessionId: session.id })
      } catch (emitError) {
        ctx.logger.warn(`dsh-evolution-review: review-error emit failed: ${emitError instanceof Error ? emitError.message : String(emitError)}`)
      }
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
    // P3-5 (v14): `lastTurn: -1` is an IN-MEMORY sentinel only — it makes the
    // first `advanceReview` always count (a PERSISTED record requires
    // lastTurn >= 0 in both providers). The save below always runs after
    // `advanceReview`, which overwrites it, so the sentinel never reaches disk.
    const state = await stateService?.loadReviewState(session.id) ?? { turnsSinceMemory: 0, turnsSinceSkill: 0, lastTurn: -1 }
    const snapshot = policy()
    // V7-02: a turn woken by our own followup still accumulates (any real
    // user content arriving with it stays in the window) but cannot fire —
    // its review prompt alone must not re-trigger cadence with interval=1.
    const skipFire = skipNextCadenceFire.get(session.id) ?? false
    if (skipFire) skipNextCadenceFire.delete(session.id)
    const rawKind = advanceReview(state, event.data.turn, signal, {
      memoryInterval: snapshot?.reviewMemoryInterval ?? config.memoryInterval,
      skillInterval: snapshot?.reviewSkillInterval ?? config.skillInterval,
      substantiveMinToolCalls: snapshot?.substantiveMinToolCalls ?? 3,
      substantiveMinUserChars: snapshot?.substantiveMinUserChars ?? 200,
      substantiveMinAgentChars: snapshot?.substantiveMinAgentChars ?? 500,
      // 0.3.40 (user decision): the counting window restarts at the INJECTION —
      // the counters stay monotonic across threshold fires and are zeroed at
      // the flush below (one injection per task segment regardless of how many
      // thresholds fired before the task ended).
      resetOnFire: false,
    })
    const kind = skipFire ? null : rawKind
    await stateService?.saveReviewState(session.id, state)
    // Cumulative tool-call counter updates on EVERY turn/end — including turns
    // that fired a cadence review — so the completion channel's long-session
    // gate reflects the whole conversation, not only cadence-free turns.
    const cumulative = (cumulativeToolCalls.get(session.id) ?? 0) + signal.toolCalls
    cumulativeToolCalls.set(session.id, cumulative)
    // V6-53 / 0.3.39: execute a deferred cadence review at conversation END —
    // BEFORE the cadence stash block, because the completing turn may itself be
    // a threshold-firing turn (the flush must still run before that return).
    // With the default trigger='cadence' the completion channel below is off
    // and exactly ONE end-of-conversation review runs.
    // 0.3.40 (user decision): the delivery is WAKING — `agent.followup` is the
    // waking next-turn alias of the send() primitive (inject = same queue,
    // non-waking), so the model starts the summary immediately instead of
    // waiting for the next driver wake. Defensive degradation: a host without
    // followup (stub/older neighbor typed narrowly) falls back to inject.
    // V7-03 (0.3.42): the subagent-path result notices use the SAME waking
    // channel — a successful review left the parent idle, and a non-waking
    // notice would sit pending until the user's next message.
    if (event.data.reason.kind === 'completed') {
      // V8-04 (0.3.48): the just-fired kind takes precedence — the completing
      // turn is LATEST-relevance (last-trigger-wins) and covers both domains
      // when it crosses the second threshold (the old latch-first form
      // discarded a fresh 'combined' and delivered a stale single kind).
      const pendingKind = kind ?? pendingCadenceReviews.get(session.id) ?? undefined
      if (pendingKind !== undefined) {
        pendingCadenceReviews.delete(session.id)
        // Explicit 'inject' deployments also execute at the end (the user
        // decision: BOTH modes complete after the task — the old immediate
        // 'inject' contract is superseded, 0.3.39).
        if ((policy()?.reviewMode ?? config.reviewMode) === 'inject') {
          try {
            deliverMessage(agent, reviewPrompt(pendingKind), 'auto-review')
          } catch (injectError) {
            ctx.logger.warn(`dsh-evolution-review: deferred review inject failed: ${injectError instanceof Error ? injectError.message : String(injectError)}`)
          }
        } else {
          const started = await trySubagentReview(session, agent, pendingKind, signal)
          if (started) {
            // V8-03 (0.3.48): the emit is a protection domain (V5-19③/F-334
            // discipline) — a throwing listener used to escape the flush,
            // skip the counter reset below and re-deliver the same kind next
            // completed turn (the V7-04 double-delivery shape, entered via
            // the emit instead of the save).
            try {
              ctx.emit('evolution/review-scheduled', {
                sessionId: session.id,
                kind: pendingKind,
                toolCalls: signal.toolCalls,
                userChars: signal.userChars,
                assistantChars: signal.assistantChars,
              })
            } catch (emitError) {
              ctx.logger.warn(`dsh-evolution-review: review-scheduled emit failed: ${emitError instanceof Error ? emitError.message : String(emitError)}`)
            }
          } else {
            // Subagent path failed at the END — fall back to the prompt delivery
            // (still at completion; there is no later boundary to defer to).
            try {
              deliverMessage(agent, reviewPrompt(pendingKind), 'auto-review')
            } catch (injectError) {
              ctx.logger.warn(`dsh-evolution-review: deferred review inject failed: ${injectError instanceof Error ? injectError.message : String(injectError)}`)
            }
          }
        }
        // 0.3.40 (user decision): the counting window restarts AT THE INJECTION
        // — zero the monotonic counters and re-persist so a continued
        // conversation starts a fresh segment from here (one injection per
        // segment; the post-flush save is authoritative over the earlier one).
        state.turnsSinceMemory = 0
        state.turnsSinceSkill = 0
        // V7-04 (0.3.42): delivery already happened before this save; a persist
        // failure means a stateful reload still sees the pre-reset counters and
        // re-delivers next completed turn — warn once per session so the repeat
        // source is identifiable (in-memory counters stay zeroed; the current
        // process keeps the fresh segment).
        try {
          await stateService?.saveReviewState(session.id, state)
        } catch (resetError) {
          if (!cadenceResetWarned.has(session.id)) {
            cadenceResetWarned.add(session.id)
            ctx.logger.warn(`dsh-evolution-review: cadence counter reset could not be persisted after a delivered review (${resetError instanceof Error ? resetError.message : String(resetError)}) — a stateful reload may re-deliver this review`)
          }
        }
        // V10-13 (P2-9): same-turn mutual exclusion. With
        // skillReviewTrigger:'both' this completed turn ALREADY delivered its
        // review through the cadence flush above; falling through to the
        // completion channel used to send a SECOND review for the same
        // boundary (double tokens, two potentially conflicting change plans).
        // The completion gate still covers every completed turn that ends
        // WITHOUT a due cadence flush, so the long-session adaptation is not
        // starved — a turn is served by exactly one review channel.
        return
      }
    }
    // V6-53 / 0.3.39 + 0.3.40: a threshold-deserved cadence review is NEVER
    // executed mid-task — NOT the subagent spawn either (BOTH channels run at
    // conversation end only). The kind is LATCHED here (one per task segment —
    // repeated threshold fires before the task ends still inject once; the
    // segment resets at the flush). A fire that arrives ON the completing turn
    // was already consumed by the flush (`?? kind`), so no latch is left.
    if (kind && event.data.reason.kind !== 'completed') {
      pendingCadenceReviews.set(session.id, kind)
      if (!pendingCadenceWarned.has(session.id)) {
        pendingCadenceWarned.add(session.id)
        ctx.logger.warn(`dsh-evolution-review: ${kind} review threshold reached; the review runs at the end of the conversation (no mid-task execution)`)
      }
      return
    }
    // B-3 (v18): a turn woken by our own followup suppresses the cadence
    // fire above; it must not fall through to the completion channel either
    // (the same double-review boundary the V10-13 guard protects).
    if (skipFire) return
    // Cadence waited; the completion channel fires once per session after a
    // task the conversation has proven long (cumulative tool-call threshold),
    // so short conversations are never adapted to at the cost of long ones.
    // P2-12 (v12): the completion channel previously injected directly,
    // bypassing deliverMessage — reviewWakeInject did not apply and the woken
    // turn's cadence fire was not suppressed. It now shares the waking
    // followup-first channel with every other review delivery.
    const trigger = config.skillReviewTrigger
    if (trigger !== 'completion' && trigger !== 'both') return
    if (completionInjected.has(session.id)) return
    if (!shouldCompletionReview(event.data.reason, cumulative, config.skillReviewCompletionMinToolCalls)) return
    completionInjected.add(session.id)
    try {
      deliverMessage(agent, COMPLETION_SKILL_REVIEW_PROMPT, 'completion review')
    } catch (injectError) {
      // V4-21 (F-334 residual ②): the flag was added BEFORE the inject; a
      // failing inject left it set, so this session's completion review was
      // permanently lost in-process. Roll it back so the next completion can
      // re-trigger (the flag is one-per-session in-memory state, not durable).
      completionInjected.delete(session.id)
      ctx.logger.warn(`dsh-evolution-review: completion review inject failed: ${injectError instanceof Error ? injectError.message : String(injectError)}`)
      return
    }
    // G4.4 (F-334): emit the schedule confirmation only after the completion
    // review inject actually dispatches (E-41 ordering: record-schedule once the
    // review was truly sent, not before a dispatch that may fail).
    // V8-03 (0.3.48): protection domain (same as the flush emit above) — the
    // weaker form: the inject already happened, so a throwing listener only
    // surfaces a spurious review-error, but the family discipline applies.
    try {
      ctx.emit('evolution/review-scheduled', {
        sessionId: session.id,
        kind: 'skill',
        toolCalls: signal.toolCalls,
        userChars: signal.userChars,
        assistantChars: signal.assistantChars,
      })
    } catch (emitError) {
      ctx.logger.warn(`dsh-evolution-review: review-scheduled emit failed: ${emitError instanceof Error ? emitError.message : String(emitError)}`)
    }
  }

  /** V7-03 (0.3.42): shared waking delivery — review prompts AND result
   * notices go through the same followup-first channel (skip the woken turn's
   * cadence fire once, degrade to inject when reviewWakeInject is off or the
   * host lacks followup). */
  const deliverMessage = (agent: import('@deepseek-ai/dsh-agent').Agent, text: string, summary: string): void => {
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'dsh-evolution-review', form: 'notice', summary },
    })
    const followup = (agent as { followup?: (message: unknown) => void }).followup
    if (config.reviewWakeInject && typeof followup === 'function') {
      followup(message)
      // V7-02: the waking turn's cadence fire is suppressed once (its own
      // review prompt must not re-trigger a review with interval=1).
      skipNextCadenceFire.set(agent.session.id, true)
    } else agent.inject(message)
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
        toolFilter: { allow: [...(config.reviewToolAllow ?? [])] },
        // V8-01 (0.3.45): the single-sourced constant — `'json'` DSL values
        // in items would be rejected by the upstream raw-schema boundary.
        outputSchema: REVIEW_OUTPUT_SCHEMA,
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
          // V5-19 (0.3.31): the error signal is inside a protection domain — a
          // throwing listener must not escape the failure path itself.
          try { ctx.emit('evolution/review-error', { sessionId: session.id }) } catch (emitError) {
            ctx.logger.warn(`dsh-evolution-review: review-error emit failed: ${emitError instanceof Error ? emitError.message : String(emitError)}`)
          }
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
        const executed = await executePlan(validation.accepted, session)
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
            deliverMessage(agent, `💾 Self-improvement review: ${applied}${note}`, 'self-improvement review')
          } catch (injectError) {
            ctx.logger.warn(`dsh-evolution-review: result notice inject failed: ${injectError instanceof Error ? injectError.message : String(injectError)}`)
          }
        } else {
          // V6-24 (0.3.36): a zero-landing plan must not be silent — the model
          // asked for a review and needs to know that nothing landed and WHY
          // (staged by approval, rejected by validation, skipped as unread, or
          // failed at execution). Same notification channel and budget as the
          // applied notice (≤500 chars).
          try {
            const reasons: string[] = []
            if (validation.rejected.length > 0) reasons.push(`${validation.rejected.length} op(s) rejected by validation`)
            if (skippedUnread > 0) reasons.push(`${skippedUnread} op(s) skipped (skill not read this session)`)
            if (executed.failedOps.length > 0) reasons.push(`${executed.failedOps.length} op(s) failed at execution: ${executed.failedOps.join('; ')}`)
            if (executed.aborted !== undefined) reasons.push(`execution aborted: ${executed.aborted}`)
            if (reasons.length === 0) reasons.push('the review plan contained nothing executable')
            let text = `💾 Self-improvement review: 0 ops landed. ${reasons.join(' ')}`
            if (text.length > 500) text = `${text.slice(0, 497)}…`
            deliverMessage(agent, text, 'self-improvement review')
          } catch (injectError) {
            ctx.logger.warn(`dsh-evolution-review: zero-landing notice inject failed: ${injectError instanceof Error ? injectError.message : String(injectError)}`)
          }
        }
        // Process event, payload v2 (sessionId) — plan-outcome durability is the
        // evolution-activity store's job; the session log stays native-only.
        // Emitted AFTER the result-notice inject (E-41 ordering: record the
        // outcome only once the model was told what landed).
        // V5-19 (0.3.31): the emit is inside a protection domain — a synchronous
        // throwing listener must not flip `started` to false via the outer catch
        // and re-trigger the same kind of review (the V4-21① shape, relocated);
        // and the payload now carries the execution-failure dimension so a
        // consumer can tell "rejected by validation" from "failed at execution".
        try {
          ctx.emit('evolution/plan-applied', {
            sessionId: session.id,
            planId: randomUUID(),
            policyFingerprint,
            memoryApplied: actions.filter(action => action.startsWith('Memory')).length,
            skillApplied: actions.filter(action => action.startsWith('Skill ')).length,
            rejectedOps: validation.rejected.length + skippedUnread,
            executionFailures: executed.failedOps.length,
            ...(executed.aborted !== undefined ? { executionError: executed.aborted } : {}),
            ...(executed.failedOps[0] !== undefined && executed.aborted === undefined ? { executionError: executed.failedOps[0] } : {}),
            evidenceQuotes,
            estimatedInputChars: reviewText.length,
          })
        } catch (emitError) {
          ctx.logger.warn(`dsh-evolution-review: plan-applied emit failed: ${emitError instanceof Error ? emitError.message : String(emitError)}`)
        }
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

  async function executePlan(
    plan: EvolutionPlan,
    session?: Session,
  ): Promise<{ actions: string[]; ok: boolean; failedOps: string[]; aborted?: string }> {
    const sessionId = session?.id
    const memory = ctx.get('memory') as MemoryLike | undefined
    const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
    // The review pipeline IS the review channel on both surfaces (rc.44 M2-2.3).
    const origins = resolveOrigins(undefined, true)
    const actions: string[] = []
    const failedOps: string[] = []
    let ok = true
    // V4-21 (F-334 residual): an op can throw an IO exception (not return
    // ok:false). Some ops may already have landed before the throw, so the
    // whole plan is a PARTIAL application — catch and return the accrued
    // `actions` with ok:false rather than letting the throw escape to the
    // subagent-review catch (which would report started=false and make the
    // caller re-inject the same kind, re-requesting an already-landed change).
    // V5-19 (0.3.31): non-throw op failures are recorded too — a plan where
    // every op failed silently used to emit nothing but an empty-applied
    // message; the failure dimension now surfaces on the event AND a warn.
    try {
      for (const op of plan.memoryOps ?? []) {
        // C4 (v15): a validator-bypassed op is RECORDED, not silently dropped —
        // it lands in failedOps (warn + zero-landing notice) so a loosened
        // validator contract can never make an op evaporate without a trace.
        if (!Array.isArray(op.evidence) || op.evidence.length === 0) {
          ok = false
          failedOps.push(`memory ${op.action ?? 'add'} ${op.target}: missing evidence (defense-in-depth rejection)`)
          continue
        }
        const target: 'memory' | 'user' = op.target === 'user' ? 'user' : 'memory'
        const normalized = { target, action: op.action ?? 'add', facts: op.facts ?? op.content, old_text: op.old_text }
        const result = approval
          ? await runApproved('memory', `memory ${normalized.target} ${normalized.action}`, normalized, normalized, session)
          : await memory?.applyBatch(normalized.target, [normalized])
        if (result?.ok) actions.push('Memory updated')
        else {
          ok = false
          failedOps.push(`memory ${normalized.action} ${normalized.target}: ${result?.message ?? 'service unavailable'}`)
        }
      }
      for (const op of plan.skillOps ?? []) {
        // C4 (v15): see the memory loop — recorded, never silently dropped.
        if (!Array.isArray(op.evidence) || op.evidence.length === 0 || !op.name) {
          ok = false
          failedOps.push(`skill ${op.action ?? 'patch'} ${op.name ?? '<unnamed>'}: missing evidence or name (defense-in-depth rejection)`)
          continue
        }
        const args = { ...op, evidence: op.evidence }
        // The registered skill runner expects the { operation, origin } wrapper;
        // passing it on both the pending record and the replay keeps the
        // background_review origin in the approval-disabled (default) path too.
        const runnerArgs = { operation: args, origin: origins.library }
        const result = approval
          ? await runApproved('skill', `skill ${op.action ?? 'patch'} ${op.name}`, runnerArgs, runnerArgs, session)
          : await executeSkillDirect(args)
        if (result?.ok) actions.push(`Skill ${op.name} ${op.action ?? 'patch'}`)
        else {
          ok = false
          failedOps.push(`skill ${op.action ?? 'patch'} ${op.name}: ${result?.message ?? 'service unavailable'}`)
        }
      }
      // V5-19: a failed execution is observable on the operator side — every
      // failure, and loudly so when NOTHING landed (the old code was silent).
      if (failedOps.length > 0) {
        ctx.logger.warn(`dsh-evolution-review: executePlan ${actions.length === 0 ? 'no op landed' : `${actions.length} op(s) landed, ${failedOps.length} failed`}: ${failedOps.join('; ')}`)
      }
      return { actions, ok, failedOps }
    } catch (error) {
      // Partial application: the ops that landed stay in `actions` so the caller
      // emits them (plan-applied) and tells the model what NOT to repeat.
      const reason = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`dsh-evolution-review: executePlan aborted mid-way after ${actions.length} ops landed: ${reason}`)
      return { actions, ok: false, failedOps, aborted: reason }
    }

    async function runApproved(kind: 'memory' | 'skill', summary: string, stored: unknown, runnerArgs: unknown, approvalSession?: Session): Promise<{ ok: boolean; message: string } | undefined> {      if (!approval) return undefined
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
      const decision = await approval.request({
        kind, summary, args: stored, origin: origins.approval,
        ...sessionId ? { sessionId } : {},
        ...approvalSession ? { session: approvalSession } : {},
      })
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
      // V10-11 (P2-7): the review's background writes previously constructed
      // the library on the hardcoded default root, so a custom-root deployment
      // wrote skills into a tree the catalog/tools never read. Route through
      // the single core resolver (empty config.skillsRoot = default root).
      const library = new SkillLibrary(resolveSkillsRoot({ root: rootConfig.root }), evolutionIoAdapter(() => io.provider()), undefined, (event) => { ctx.emit('evolution/skill-mutated', event) })
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
      // P3 (v16): no `?? op.content` fallback — the validator (plan-validator
      // write_file gate) and the approval runner (tool-skill-manage) are both
      // file_content-only; the fallback here was a dead-but-divergent branch.
      if (op.action === 'write_file') return await library.writeSupportFile(name, op.file_path ?? '', op.file_content ?? '', origin)
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
    // V7-16 (0.3.44): enumerate EVERY per-session state map — the 0.3.38-0.3.42
    // additions (pendingCadenceReviews/pendingCadenceWarned/skipNextCadenceFire/
    // cadenceResetWarned) were missing from the cleanup list; the closures were
    // reclaimed with the fiber anyway (no real leak), but the cleanup contract
    // now matches the full set.
    turnStarts.clear()
    cumulativeToolCalls.clear()
    completionInjected.clear()
    pendingCadenceReviews.clear()
    pendingCadenceWarned.clear()
    skipNextCadenceFire.clear()
    cadenceResetWarned.clear()
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
    // V6-26 (0.3.37): the validator normalizes a missing action to 'patch', so
    // the check no longer needs the `!== undefined` precondition — a missing
    // action is a patch (read-required), never silently exempt.
    if (op.name && READ_REQUIRED.includes(op.action ?? 'patch') && !readNames.has(op.name)) {
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

// V10-10 (P2-11): minimal LOCAL structural types for the upstream rc.2
// 'tool/result' payload (`SessionEventMap['tool/result']` = `{ turn, step,
// message: ToolResultMessage, error?, meta? }`) and its `ToolResultBlock`
// (`{ type: 'tool-result', toolCallId, content: ContentBlock[], isError? }`).
// Deliberately NOT an upstream type dependency (the mirror tree has no
// upstream node_modules); only the fields read below are declared.
interface ToolResultEventDataLike {
  error?: unknown
  message?: {
    content?: Array<{
      type?: string
      isError?: boolean
      /** Tolerated legacy/alternative shape: text directly on the block. */
      text?: string
      /** Upstream ToolResultBlock: the payload text lives in inner text blocks. */
      content?: Array<{ type?: string; text?: string }>
    }>
  }
}

/**
 * V10-10 (P2-11): render one `[result]` evidence line from a 'tool/result'
 * event payload. The former read (`data.output`) targeted a field that does
 * not exist on the upstream rc.2 payload, so EVERY result line rendered an
 * empty payload and the review subagent never saw tool output — the evidence
 * chain silently starved while still spending its line budget. The payload
 * text now comes from `data.message.content` tool-result blocks (inner text
 * blocks joined, mirroring the user/assistant rendering above). A failure is
 * marked by the payload-level `error` OR a block-level `isError`. The legacy
 * pre-rc.2 shape (no `message`) is tolerated as an empty payload — it never
 * throws. Budget: 500 chars per line (the 12-line cap lives in
 * buildReviewRequest and is unchanged).
 */
export function renderToolResultLine(data: unknown): string {
  const shape = data as ToolResultEventDataLike | undefined
  const content = shape?.message?.content
  const blocks = Array.isArray(content) ? content : []
  const resultBlocks = blocks.filter(block => block.type === 'tool-result')
  const output = resultBlocks
    .map(block => Array.isArray(block.content)
      ? block.content
        .map(inner => inner.type === 'text' && typeof inner.text === 'string' ? inner.text : '')
        .join(' ')
      : (typeof block.text === 'string' ? block.text : ''))
    .join(' ')
    .trim()
  const failure = shape?.error || resultBlocks.some(block => block.isError === true) ? ' [ERROR]' : ''
  return `[result]${failure} ${output.slice(0, 500)}`
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
      toolLines.push(renderToolResultLine(event.data))
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
