/**
 * Background review orchestration: signal gate → one-shot subagent → trusted plan execution.
 * @module @deepseek-ai/dsh-evolution-review
 */

import type { Context, Fiber, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
// 0.2.x replaced the shared `{ kind: 'plugin', plugin }` source with a merge-extensible
// map: each producer declares its own kind in its own module, and there is no shared
// catch-all plugin kind (llm/src/message.ts:103-115).
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'evolution-review': { kind: 'evolution-review' } & ContextFormed
  }
}
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import { advanceReview, assertSkillsRootAliasRetired, clearReviewChannel, markReviewChannel, sweepReviewChannelSessions, type EvolutionReviewScheduledEvent, type ReviewKind, type ReviewState } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-state'
import { liveBool, unwrapLive, PROMPT_BUNDLE, reviewPrompt, verifyPromptBundle, COMPLETION_SKILL_REVIEW_PROMPT, MAX_TIMER_DELAY_MS, DEFAULT_REVIEW_MEMORY_INTERVAL, DEFAULT_REVIEW_SKILL_INTERVAL, DEFAULT_REVIEW_TIMEOUT_MS, DEFAULT_SKILL_REVIEW_TRIGGER, DEFAULT_SKILL_REVIEW_COMPLETION_MIN_TOOL_CALLS, DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS, DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS, DEFAULT_SUBSTANTIVE_MIN_USER_CHARS, clampOnce, pickWithPolicy, userSetKeys } from '@deepseek-ai/dsh-evolution-core'
import type { LiveValue } from '@deepseek-ai/dsh-evolution-core'
// v37 P7a: the platform dispatch vocabulary is read in ONE place —
// evolution-core's tool-dispatch module, which owns the event types, the
// per-dispatch dedup and the skill-read tool names. This file matches on
// `ToolDispatchSignal` fields instead of on an event type.
import { classifySessionEvent, paramRowId, readDispatchSignal, sessionAudited, sessionTurnSignals } from '@deepseek-ai/dsh-evolution-core'

import { isReviewNotice, noticeAfter, type NoticeEventKind, type NoticeMessage, type ReviewNotice } from './review-notice.ts'

// The read-before-write RULE moved to evolution-core (ONE rule for both enforcement points: the
// tool path and this plan path — design dsh-evolution-write-gate-design.md §4.2); the READER is
// core's reader (the `evolutionReads` projection for a real Session, the structural accessor for a
// bare stub view). Re-exported so this package's published surface keeps naming the rule.
export { filterUnreadSkillOps } from '@deepseek-ai/dsh-evolution-core'
import type { PolicySnapshot } from '@deepseek-ai/dsh-evolution-policy'
import { SessionScopedState } from './session-state.ts'

/** Emit one `evolution/review-scheduled` inside its OWN protection domain (V8-03, V5-19③/F-334).
 *
 * Every delivery path must enter that domain, and five hand-copied try/emit/catch blocks had
 * already drifted twice: V24-15 had to add the emit to two injection paths that never had it, and
 * V25-02 fixed a cross-session attribution bug that lived in one of the copies. The fields, the
 * channel and the domain now travel together.
 * @param ctx - the plugin context the event is emitted on.
 * @param event - the payload. `sessionId` is the session the review was scheduled FOR — on the
 * deferred drain that is the entry's session, never the in-flight review's.
 */
function emitReviewScheduled(ctx: Context, event: EvolutionReviewScheduledEvent): void {
  try {
    ctx.emit('evolution/review-scheduled', event)
  } catch (emitError) {
    ctx.logger.warn(`dsh-evolution-review: review-scheduled emit failed: ${emitError instanceof Error ? emitError.message : String(emitError)}`)
  }
}


/** S2-6 (FLOW1-1): the settle-grace margin a subagent handle gets beyond its
 * own deadline before the review abandons it. As the dispose watchdog's WHOLE
 * budget it is capped by the review timeout so a short (test) budget stays
 * short; the result watchdog adds it AFTER the full timeout (PLAN S1.1,
 * 2026-09-16) and caps the sum at the timer ceiling (PLAN-R2 P2-1). The
 * `run.dispose` arm point counts this margin ALONE — its clock starts after
 * the result settled, not at the review timeout (PLAN-R2 P2-2, 2026-09-16). */
/** Error name marking the S2-6 watchdog expiry (see the catch in trySubagentReview). */

export const name = 'evolution-review'
export const inject = ['agents']

/** Result notices are optional; a review PROMPT is the review itself in inject mode. */
export function noticeAllowed(reviewPrompt: boolean, notice: boolean): boolean {
  return reviewPrompt || notice
}

// V27 G2.4: `MAX_TIMER_DELAY_MS` comes from evolution-core/constants.ts — the
// ONE definition (this file used to carry a second copy of the literal). Node's
// 32-bit timer-delay ceiling (`AbortSignal.timeout`/`setTimeout`) throws
// RangeError above it: B-2 (v18) — without a max, a misconfigured
// `reviewTimeoutMs` made `AbortSignal.timeout` throw inside the subagent start
// call, and the outer catch logged it and silently degraded the review to the
// inject path. The schema and the assembly clamp both reject it (same bound as
// commands/maintenance).

export interface Config {
  reviewEnabled?: Volatile<boolean>
  /** How the flush delivers the review: `'inject'` (default since 0.3.74) hands
   * the review prompt to the PARENT agent — waking it through the same
   * followup-first channel — so the review runs on the parent's model against
   * the parent's already-cached prefix and no separate prefill is paid.
   * `'subagent'` spawns a one-shot child instead: the parent context stays clean
   * and the review can use a dedicated model, but the child re-prefills its own
   * system prompt plus a re-serialized conversation digest
   * (`buildReviewRequest`, redacted, header-prepended) on a DIFFERENT model —
   * so no prefix cache is shared with the parent and the input tokens are paid
   * at full price. Deployments that prefer the clean-context split switch the
   * POLICY row (`evolution-policy`): the mounted policy snapshot shadows this
   * row's value, which the plugin reports once at load (v37 P2-24). */
  reviewMode?: Volatile<'inject' | 'branch'>
  /** Review cadence in TOOL CALLS — the CANONICAL registry id (G1, signals.ts:
   * a turn advances by its tool-call count, minimum 1, or by 1 when the turn
   * itself carried the memory signal). Shadowed by the policy snapshot in every
   * shipped composition — configure `reviewMemoryInterval` on the
   * `evolution-policy` row instead (v37 P2-24). */
  reviewMemoryInterval?: Volatile<number | undefined>
  /** Skill-channel review cadence — the CANONICAL registry id (G1); shadowed by
   * the policy snapshot like the memory cadence. */
  reviewSkillInterval?: Volatile<number | undefined>
  /** Deprecated alias of `reviewMemoryInterval` (G0/S0.3): still readable,
   * refused by writes; removal was planned for 0.7.0 and is deferred (the alias still ships — see the package README). */
  memoryInterval?: number
  /** Deprecated alias of `reviewSkillInterval` (G0/S0.3): still readable,
   * refused by writes; removal was planned for 0.7.0 and is deferred (the alias still ships — see the package README). */
  skillInterval?: number
  reviewTimeoutMs?: number
  /** E3/P1-8 (v11) — TRUE semantics: this flag gates ONLY the completion
   * channel. The cadence latch stays active regardless of the value (a
   * completion-gated deployment still fires at the policy cadence), so
   * 'completion' does NOT mean "cadence off", and 'both' is effectively
   * "completion on top of the always-on cadence". The mutually-exclusive
   * channel reading in earlier docs was wrong. */
  skillReviewTrigger?: Volatile<'cadence' | 'completion' | 'both'>
  /** Cumulative session tool calls before a session counts as proven-long for the completion channel. */
  skillReviewCompletionMinToolCalls?: Volatile<number>
  /** 0.3.40: deliver the deferred review with a WAKING inject for a summary the
   * model starts immediately (agent.followup — same send() queue, wakeup bit
   * differs). Default true; false degrades to the non-waking inject (the
   * summary then waits for the next driver wake). */
  reviewWakeInject?: Volatile<boolean>
  /** Deliver result notices into the parent conversation. Default true. A review PROMPT is the
   * review itself in inject mode, so this never suppresses prompt delivery — only the result
   * notice (and late/zero-landing notices) that wakes a turn just to report a count. */
  reviewNotice?: Volatile<boolean>
  /** V10-11 (P2-7): skill tree root for the review's direct skill writes.
   * Empty (the default) resolves through `resolveSkillsRoot` to the shared
   * default root — the historical behavior. A custom root keeps review-created
   * skills in the SAME tree the catalog/tools read instead of writing a
   * parallel tree the rest of the family cannot see. E-7 (v18): canonical key. */
  root?: string
  /** V27 G2.4 (M-08): the retired `skillsRoot` alias, kept in the schema so a
   * config that still sets it reaches {@link assertSkillsRootAliasRetired} and
   * fails the load instead of being silently dropped. Never read. */
  skillsRoot?: string
  /**
   * Act only on sessions that carry the family's model tools (evolution-core's
   * per-session probe). The shipped bundles set it: at profile root every
   * session carries them, inside a variant preset only the sessions that
   * selected one do. False — a bare library mount, the host-only infrastructure
   * mode, and every deployment that predates this field — acts on every session.
   */
  sessionScoped?: boolean
}

// G1: the seven E3 keys carry `.volatile()`, so the platform hands the plugin a
// stable reference it updates in place and the settings surface edits them live. The
// schema keeps NO annotation: a volatile field's output is a reference, which the
// annotated `z<Config>` reading cannot express (TS2375).
export const Config = z.object({
  reviewEnabled: z.boolean().default(true).volatile(),
  // 0.3.74: default is 'inject' — see the Config JSDoc. 'subagent' stays a
  // first-class opt-in for deployments that want the parent context kept clean
  // or a dedicated review model.
  reviewMode: z.union([z.const('inject'), z.const('branch')]).default('inject').volatile(),
  // G1: the canonical registry ids, merged into the row Config. No .default(): a
  // schema default would fill the canonical key and make the deprecated alias
  // below unreachable through the alias fallback (resolveReviewRowSettings resolves
  // the default after it).
  reviewMemoryInterval: z.number().min(1).volatile(),
  reviewSkillInterval: z.number().min(1).volatile(),
  // Deprecated row aliases (PARAM_ALIASES): still read as the fallback spelling,
  // refused by writes; removal was planned for 0.7.0 and is deferred (the alias still ships). Deployment-only (no `.volatile()`).
  memoryInterval: z.number().min(1).default(DEFAULT_REVIEW_MEMORY_INTERVAL),
  skillInterval: z.number().min(1).default(DEFAULT_REVIEW_SKILL_INTERVAL),
  reviewTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_REVIEW_TIMEOUT_MS),
  // V7-15 (0.3.44): the trigger is closed to the three known values — a typo
  // cannot silently select a fourth behavior. Note: schemastery is tolerant
  // (it STRIPS an unmatching value and keeps the default), so the runtime
  // degradation is silent by design; the union keeps the TYPE surface closed
  // for config authors.
  skillReviewTrigger: z.union([z.const('cadence'), z.const('completion'), z.const('both')]).default(DEFAULT_SKILL_REVIEW_TRIGGER).volatile(),
  reviewWakeInject: z.boolean().default(true).volatile(),
  reviewNotice: z.boolean().default(true).volatile(),
  sessionScoped: z.boolean().default(false),
  skillReviewCompletionMinToolCalls: z.number().min(1).default(DEFAULT_SKILL_REVIEW_COMPLETION_MIN_TOOL_CALLS).volatile(),
  // V10-11 (P2-7): empty string keeps the default root (resolveSkillsRoot
  // trims and falls back) — the schema default mirrors the Config contract.
  // E-7 (v18) → V27 G2.4: `root` is canonical. The retired `skillsRoot` alias
  // stays declared so a stale config reaches assertSkillsRootAliasRetired()
  // and fails the load; nothing reads the value.
  root: z.string().default(''),
  skillsRoot: z.string().default(''),
})



/** V8-01 (0.3.45): the minimal start() request shape the review passes — the
 * OUTPUT SCHEMA part is typed against the raw JSON-Schema subset vocabulary,
 * so a defineTool DSL value like `'json'` fails at the type surface instead
 * of silently rejecting every spawn at runtime (the historical defect the
 * mock-based tests and the previous `unknown` request type could not see). */

/**
 * S2-8 (FLOW1-3): the platform `Inbox` surface (public `Agent.inbox`,
 * `core/agent/src/runtime-types.ts`) read by the delivery path to see whether
 * HUMAN input is already queued ahead of the review prompt.
 *
 * T2-04/A72: this is a MINIMAL VIEW on purpose, not a stale copy. The platform's `Inbox` is
 * importable from `@deepseek-ai/dsh-agent` (its index re-exports `runtime-types.ts`), so the earlier
 * claim that the type is "not importable here" was wrong; what the family actually needs is the
 * OPPOSITE typing — a SOFT probe. `Agent.inbox` may be absent on a host that mounts no queue, and
 * every member here stays optional so the delivery path degrades to the historical behavior instead
 * of throwing on a surface a partial composition does not carry. Using the platform's own (all-
 * required) interface would move that optionality onto the wrong side of the seam. The coupling is
 * kept honest by a contract anchor (`agent-inbox-surface` in verify-platform-contract.mjs), so a
 * rename of `Inbox`/`nextTurn`/`nextStep` turns the gate red instead of silently degrading.
 */
interface InboxLike {
  readonly nextTurn?: readonly PendingMessageLike[]
  readonly nextStep?: readonly PendingMessageLike[]
}

/** The parts of a pending `UserMessage` the delivery path reads: its identity and its source. */
interface PendingMessageLike {
  readonly id: string
  readonly source?: { kind?: string; plugin?: string; form?: string; summary?: string }
}

/**
 * v43 audit (P1-4 / FLOW1): the cadence summary MUST name the review kind — it
 * is what tells the three cadence deliveries apart (their prompts differ by
 * kind: memory / skill / combined), both in the queue and in the session log.
 */
const cadenceSummary = (kind: ReviewKind): string => `auto-review:${kind}`

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

/** F5 (P2-16, v11): the clamp sets exactly these four numeric fields — the
 * old `as Required<Config>` lied about `reviewToolAllow` etc. being populated
 * (`[...undefined]` TypeErrors under a direct `apply(ctx, {})`).
 * G1: the seven E3 keys left this list — they are live and resolved at USE time by
 * {@link resolveReviewRowSettings}, which clamps its own numerics. */
type ClampedReviewConfig = Config & {
  reviewTimeoutMs: number
}

/**
 * The DEPLOYMENT layer of this row, clamped once at assembly: the restart-only
 * numerics (registry tier E2) whose consumers read them from this snapshot. The
 * seven E3 keys are NOT resolved here — they are live (G1 §8.3), and
 * {@link resolveReviewRowSettings} reads them at every use.
 * @param rawConfig - the row config as the platform resolved it.
 * @param ctx - the plugin context, for the clamp warning.
 * @returns the deployment layer with its numerics clamped.
 */
export function clampReviewConfig(rawConfig: Config, ctx: Context): ClampedReviewConfig {
  const warned = new Set<string>()
  const warn = (message: string): void => { ctx.logger.warn('dsh-evolution-review: ' + message) }
  const field = (name: string, value: number | undefined, fallback: number, min: number, max?: number): number =>
    clampOnce(warned, warn, name, value, fallback, min, max)
  return Object.assign({}, rawConfig, {
    // B-2 (v18): the 32-bit ceiling is enforced here as well as in the schema
    // (the schema may be bypassed by a programmatic assembly; clampedNumber
    // also catches NaN/±Infinity, which z.number() lets through).
    reviewTimeoutMs: field('reviewTimeoutMs', rawConfig.reviewTimeoutMs, DEFAULT_REVIEW_TIMEOUT_MS, 1, MAX_TIMER_DELAY_MS),
  })
}

/** Review behaviour a user may change (G3/S3.1). Field names are the CANONICAL
 * parameter ids from the registry, so the settings document, the params output,
 * the doctor report and the cards all spell one name. */
export interface ReviewSettings {
  /** Tool calls between skill-review injections (a turn with no tool call counts as one; a turn
   * that itself used a skill advances the counter by 1). */
  reviewSkillInterval: number
  /** Tool calls between memory-review injections (a turn with no tool call counts as one; a turn
   * that itself touched memory advances the counter by 1). */
  reviewMemoryInterval: number
  /** Which channel may inject a skill review. */
  skillReviewTrigger: 'cadence' | 'completion' | 'both'
  /** Tool calls a task needs before the completion channel injects. */
  skillReviewCompletionMinToolCalls: number
  /** Master switch for the review plugin. */
  reviewEnabled: boolean
  /** Run the review in the parent session (inject) or on a subagent. */
  reviewMode: 'inject' | 'branch'
  /** Deliver the deferred review as a waking follow-up message. */
  reviewWakeInject: boolean
  /** Deliver result notices (not review prompts). */
  reviewNotice: boolean
}

/**
 * This row's review knobs as they stand RIGHT NOW (G1 §8.3) — the base layer of the
 * precedence chain. The seven E3 keys are live: the platform hands each one a
 * reference it updates in place, so a committed settings edit needs neither a restart
 * nor a watcher. The deprecated cadence aliases stay the fallback spelling of the two
 * interval keys, and every numeric field is clamped (G3.1).
 * @param rawConfig - the row config as the platform resolved it.
 * @param warn - sink for the once-per-key clamp warning.
 * @returns the row layer of the review knobs.
 */
export function resolveReviewRowSettings(rawConfig: Config, warn: (message: string) => void): ReviewSettings {
  const warned = new Set<string>()
  return {
    reviewSkillInterval: clampOnce(warned, warn, 'reviewSkillInterval', unwrapLive(rawConfig.reviewSkillInterval) ?? rawConfig.skillInterval, DEFAULT_REVIEW_SKILL_INTERVAL, 1),
    reviewMemoryInterval: clampOnce(warned, warn, 'reviewMemoryInterval', unwrapLive(rawConfig.reviewMemoryInterval) ?? rawConfig.memoryInterval, DEFAULT_REVIEW_MEMORY_INTERVAL, 1),
    skillReviewTrigger: unwrapLive(rawConfig.skillReviewTrigger) ?? DEFAULT_SKILL_REVIEW_TRIGGER,
    skillReviewCompletionMinToolCalls: clampOnce(warned, warn, 'skillReviewCompletionMinToolCalls', rawConfig.skillReviewCompletionMinToolCalls, DEFAULT_SKILL_REVIEW_COMPLETION_MIN_TOOL_CALLS, 1),
    reviewEnabled: liveBool(rawConfig.reviewEnabled, true),
    reviewMode: unwrapLive(rawConfig.reviewMode) ?? 'inject',
    reviewWakeInject: liveBool(rawConfig.reviewWakeInject, true),
    reviewNotice: liveBool(rawConfig.reviewNotice, true),
  }
}

export function apply(ctx: Context, rawConfig: Config = {}): void {
  // G1: suppress the platform's auto-generated settings page for this row (the
  // family renders its own card from the registry). Probed, not assumed: a host
  // without the capability still loads.
  ctx.inject(['settings'], (injected) => {
    const settings = (injected as { settings?: { configure?: (presentation: { auto?: boolean }, owner?: Fiber) => unknown } }).settings
    if (typeof settings?.configure !== 'function') return
    // v46 S1.12b (finding 6-1): the owner argument is what the platform looks the presentation up by.
    // Omitting it registers the suppression on the settings service's own fiber, so a row that
    // re-mounts keeps a dead key and the auto form can return (platform precedent:
    // settings.configure({ auto: false }, plugin.fiber) — settings/src/index.ts:266).
    const disposer = settings.configure({ auto: false }, ctx.fiber)
    if (typeof disposer === 'function') ctx.effect(() => disposer as () => void, 'dsh-evolution-review: settings presentation')
  })
  if (!verifyPromptBundle(PROMPT_BUNDLE)) {
    throw new Error('dsh-evolution prompt bundle integrity check failed; refusing to schedule review work')
  }
  const config = clampReviewConfig(rawConfig, ctx)
  // W5 G3-S3: ONE execution path for both review channels; the channel is fiber-owned (HMR safe).
  // E-7 (v18) → V27 G2.4 (M-08): canonical `root` only; the expired
  // `skillsRoot` alias fails the load instead of being silently ignored.
  assertSkillsRootAliasRetired(rawConfig)
  // P1-9 (S2-2): every per-session collection below registers at its declaration
  // site; the dispose hook clears what was registered instead of a hand-written
  // list (V7-16 fixed such a list after four additions were missing from it).
  const sessionState = new SessionScopedState()
  // G4: no `turnStarts` map any more — the turn window is the family's `evolutionSignals`
  // projection, which resets itself at `turn/start` (the map existed only to remember that seq).
  // G4: the review digest's tool evidence is a BOUNDED tail of dispatch frames, appended as they
  // arrive. Re-reading the session log at every review was the last synchronous log read; the
  // platform's `deriveMessages()` carries native tool blocks, but a PTC sub-dispatch is log-only
  // (it never becomes a message), so the family keeps its own tail instead of losing that evidence.
  const dispatchDigest = sessionState.add('dispatchDigest', new Map<SessionId, ReviewDispatchFrame[]>())
  // P3 (v15): per-mount one-shot for the stateless warn (was module-level).
  let statelessReviewStateWarned = false
  // S2-8 (FLOW1-3): the mark was withheld because human input was queued ahead.
  let channelMarkSuppressedWarned = false
  // C 组（未结窗口）：闸门挡住一次投递时说一次就够 —— 任务期间每个边界都会被挡，逐次 warn 只会刷屏。
  // 与 channelMarkSuppressedWarned 同款：每次挂载一条，不做 per-session 记账。
  let reviewNoticeOutstandingWarned = false
  // Completion-channel state (E-59f): these two are deliberately NOT persisted
  // to ReviewState. A process restart resets the "session is proven-long"
  // counter and the "completion already injected" flag — which is ACCEPTED:
  // the completion review is a one-per-session post-task adaptation, and a
  // restart is a fresh conversation boundary. The cadence state (turnsSince*)
  // is persisted via ReviewState; the completion channel is a lighter, lossy
  // signal whose cost of losing (a deferred review) is lower than the cost of
  // widening the on-disk record contract.
  const cumulativeToolCalls = sessionState.add('cumulativeToolCalls', new Map<SessionId, number>())
  const completionInjected = sessionState.add('completionInjected', new Set<SessionId>())
  // V6-53 / 0.3.38 (deferred cadence inject): a threshold-deserved review whose
  // subagent path was unavailable is HELD here (last trigger wins — the most
  // recent relevance) and injected at conversation completion instead of
  // interrupting the task (and invalidating the prefix cache from that point
  // on). Same in-memory discipline as the completion channel: a restart is a
  // fresh conversation boundary, and the deferred review is a light loss.
  const pendingCadenceReviews = sessionState.add('pendingCadenceReviews', new Map<SessionId, ReviewKind>())
  const pendingCadenceWarned = sessionState.add('pendingCadenceWarned', new Set<SessionId>())
  // C 组（未结窗口）：投递后的「抑制接下来那个回合」表（skipNextCadenceFire）与它依赖的
  // lastTurnStart 已删除。V7-02 要挡的是「我们自己的提示词唤起的那个回合」，而 pendingReviewNotices
  // 直接带着「取走它的回合号」——按那条消息本身识别，不必从投递顺序去猜哪个回合结束算数
  // （S2-9 的忙期误判与 PLAN-R2 的 `turns: 2` 计数随之一起消失）。

  // A 组（未结窗口）：本会话唯一一条尚未结清的复查通知，以及取走它的回合号。三条 inbox 事件
  // 维护它（inserted／claimed／discarded）；B 组才把「结清」接到计数清零上——本组只记录，
  // 不改变任何投递与计数行为。
  const pendingReviewNotices = sessionState.add('pendingReviewNotices', new Map<SessionId, ReviewNotice>())
  // V7-04 (0.3.42): the post-delivery counter reset may fail to persist (state
  // store IO failure) — delivery already happened, so warn once per session
  // about the repeat-review source instead of silently re-delivering forever.
  const cadenceResetWarned = sessionState.add('cadenceResetWarned', new Set<SessionId>())
  // 0.3.18 (E-19): ONE in-flight review subagent process-wide. The shared
  // skill tree and memory have no cross-writer mutex, so two overlapping
  // reviews (a 120s window is long) could fuzzyPatch the same file
  // concurrently. While set, turn/end signals still accumulate (state was
  // already advanced above) but never spawn a second subagent.
  // v20 (C-3) cross-layer contract: the ONLY writer exclusion shared with the
  // curator is skill-store's per-file write lock + the F-17 marker probe (a
  // destructive mover refuses a directory whose writer lock is alive) —
  // curator's acquireMutex serializes its OWN package only. Automatic curator
  // passes stay out of the session-active window via the min-idle gate,
  // checked pre-run AND re-checked at the commit boundary (v28 G4.2: a
  // session activating mid-run no longer slips past it); a
  // manual `/evolution curator run` (ignoreGates) is the one realistic
  // interleave window: the loser records a failed op and the snapshot stays
  // the rollback path. Accepted + documented (plan v20 C-3①); the same
  // statement lives on evolution-curator's acquireMutex.
  /** Branch mode runs at most one branch per parent session; a second trigger only sets rerun. */
  const branchRunning = sessionState.add('branchRunning', new Map<SessionId, { rerun?: ReviewKind }>())
  /** Child Sessions this plugin owns; their turn/end must not start another review. */
  const branchSessions = sessionState.add('branchSessions', new Set<SessionId>())
  const policy = () => (ctx.get('evolutionPolicy') as { get(): PolicySnapshot } | undefined)?.get()

  /**
   * This row's knobs as they stand right now (G1 §8.3): the live fields are resolved
   * per call, so a committed edit needs neither a restart nor a watcher.
   * @returns the row layer of the review settings.
   */
  const rowSettings = (): ReviewSettings =>
    resolveReviewRowSettings(rawConfig, (message) => { ctx.logger.warn('dsh-evolution-review: ' + message) })
  // S2.9 (T3-10): the settings user layer is read through ONE core function
  // (`userSetKeys`), which reads KEY NAMES and never values — the platform resolves the user
  // layer into the row's live fields, so the value comes from `rowSettings()`.
  // G3/S3.1 + G1: the USER layer sits above the deployment carriers. `params()` is the
  // one reader of the review group's behaviour knobs: a key the user set (its value
  // arrived through the row's live field), then the policy snapshot, then this row —
  // the precedence the design fixes (user > deployment > default). Consumers call it
  // at USE time, so a committed settings change is live.
  const params = (): ReviewSettings => {
    const row = rowSettings()
    const userSet = userSetKeys(ctx, paramRowId('evolution-review'))
    const snapshot = policy()
    // Only these three knobs have a policy carrier; the other four end at the row. The
    // precedence itself is core's `pickWithPolicy` (ONE rule for both readers of the policy row).
    const pick = (key: 'reviewSkillInterval' | 'reviewMemoryInterval'): number =>
      pickWithPolicy(userSet, row, snapshot, key)
    const mode = (): 'inject' | 'branch' => {
      if (userSet.has('reviewMode')) return row.reviewMode
      return snapshot?.reviewMode ?? row.reviewMode
    }
    return {
      reviewSkillInterval: pick('reviewSkillInterval'),
      reviewMemoryInterval: pick('reviewMemoryInterval'),
      skillReviewTrigger: row.skillReviewTrigger,
      skillReviewCompletionMinToolCalls: row.skillReviewCompletionMinToolCalls,
      reviewEnabled: row.reviewEnabled,
      reviewMode: mode(),
      reviewWakeInject: row.reviewWakeInject,
      reviewNotice: row.reviewNotice,
    }
  }

  // S2.2 (v37 P2-24) + G1: the policy snapshot shadows these three row knobs in every
  // shipped composition (host/all/preset). "This row set a value" is read as "the live
  // reference resolves to a value" for the canonical key, and as "differs from that
  // schema default" for a deprecated alias (the loader fills the alias default in). A
  // key the USER set is excluded: that value wins over the policy (G1 §8.4-A), so
  // reporting it as ineffective would be false.
  const schemaDefaults = (Config as unknown as { ['~standard']: { validate(input: unknown): { value: Config } } })['~standard'].validate({}).value
  /** The value the schema fills in when nobody sets the key — for a volatile field the
   * reference is always present, so this is what "the row set nothing" resolves to. */
  const SHADOW_DEFAULTS = { reviewMode: 'inject', reviewMemoryInterval: DEFAULT_REVIEW_MEMORY_INTERVAL, reviewSkillInterval: DEFAULT_REVIEW_SKILL_INTERVAL } as const
  const rowSupplied = (id: keyof typeof SHADOW_DEFAULTS, alias?: 'memoryInterval' | 'skillInterval'): boolean => {
    // The key is a union of differently-typed volatile fields, so the read is asked as unknown:
    // unwrapLive cannot unify a union of payload types, and this site only compares against defaults.
    const canonical: unknown = unwrapLive(rawConfig[id] as LiveValue<unknown>)
    if (canonical !== undefined && canonical !== SHADOW_DEFAULTS[id]) return true
    return alias !== undefined && rawConfig[alias] !== undefined && rawConfig[alias] !== schemaDefaults[alias]
  }
  const shadowedRowFields = ([
    ['reviewMode', undefined],
    ['reviewMemoryInterval', 'memoryInterval'],
    ['reviewSkillInterval', 'skillInterval'],
  ] as const)
    .filter(([id, alias]) => !userSetKeys(ctx, paramRowId('evolution-review')).has(id) && rowSupplied(id, alias))
    .map(([id]) => id)
  if (shadowedRowFields.length > 0) {
    let shadowWarned = false
    const warnShadowed = (): void => {
      if (shadowWarned) return
      shadowWarned = true
      ctx.logger.warn(`dsh-evolution-review: this row sets ${shadowedRowFields.join(', ')}, but the mounted evolution-policy service overrides ${shadowedRowFields.length === 1 ? 'it' : 'them'} — these row values have no effect. Set them on the evolution-policy row instead.`)
    }
    // The mounted service shadows them; a host without it keeps the row values,
    // so the warning must wait for the service rather than assume the default.
    if (policy() !== undefined) warnShadowed()
    else ctx.inject(['evolutionPolicy'], () => { warnShadowed() })
  }

  // S2.2 (v37 P1-1③): the 'inject' channel executes the review in the parent
  // session and emits no `evolution/plan-applied` — an empty ledger is a
  // property of the composition, so it is disclosed once at load, not per review.
  if (params().reviewMode === 'inject') {
    ctx.logger.warn('dsh-evolution-review: reviewMode "inject" (default) runs the review in the parent session and emits NO evolution/plan-applied ledger entry — evolution-activity and evolution-replay stay empty in this mode (see the evolution-review README, "Known Limitations and Deferred Work"). Set reviewMode: "subagent" on the evolution-policy row to keep the audited plan path.')
  }

  // V24-04 (v24): per-session mutex over the persisted review-state RMW.
  // Entries self-remove when the chain drains (no sweep needed); the dispose
  // hook clears the map like the other per-session state.
  const reviewStateLocks = sessionState.add('reviewStateLocks', new Map<SessionId, Promise<unknown>>())
  async function withReviewStateLock<T>(id: SessionId, task: () => Promise<T>): Promise<T> {
    const previous = reviewStateLocks.get(id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    reviewStateLocks.set(id, next)
    try {
      return await next
    } finally {
      if (reviewStateLocks.get(id) === next) reviewStateLocks.delete(id)
    }
  }

  ctx.on('session/event', (session, event) => {
    // C axis (v41): only the sessions that actually carry the family's model
    // rows are reviewed. Without this gate a user who installed a variant was
    // still injected with review prompts in a session running the platform's
    // original preset — the family acting on a session that never opted in.
    // A deployment that declares no session scoping is unaffected by construction.
    if (!sessionAudited(ctx, session.id, config.sessionScoped)) return
    // G6-S2/W8 fold: a plugin record is not evidence and not a turn boundary — it is tolerated
    // read-only and never enters the dispatch digest (one classifier: core session-fold).
    if (classifySessionEvent(event) === 'plugin-record') return
    appendDispatchFrame(dispatchDigest, session.id, event)
    // S2.2 (v37): `{ kind: 'user' }` is the platform's attestation of human
    // input and ends the review window; plugin notices (our prompt included)
    // never do. `data` crosses the durable log, so the guard tolerates garbage.
    if (event.type === 'user/message') {
      const data: unknown = event.data
      const source = (data as { source?: { kind?: unknown } } | null | undefined)?.source
      if (source?.kind === 'user') clearReviewChannel(session.id)
      return
    }
    if (event.type !== 'turn/end') return
    // Counter sweep (rc.42 audit P1-10): the per-session maps grow with every
    // session that ever emitted a turn event, and the platform has no
    // in-process session-end hook to prune against (skill §15). Under size
    // pressure, drop entries whose agent is gone — they can never be read
    // again; live sessions keep their counters.
    // R2 (round-2 audit): pendingCadenceWarned is swept below but was not in
    // the trigger set — its entries lingered until another map crossed the
    // threshold.
    // S2.9 (T3-11): ONE condition per swept map — the trigger list repeats each of the seven
    // maps below and nothing else (cumulativeToolCalls was listed twice, a copy-paste residue that
    // would have hidden a missing map behind a duplicate).
    const sweepDue = cumulativeToolCalls.size >= COUNTER_SWEEP_THRESHOLD
      || dispatchDigest.size >= COUNTER_SWEEP_THRESHOLD
      || completionInjected.size >= COUNTER_SWEEP_THRESHOLD
      || pendingCadenceReviews.size >= COUNTER_SWEEP_THRESHOLD
      || pendingCadenceWarned.size >= COUNTER_SWEEP_THRESHOLD
      || cadenceResetWarned.size >= COUNTER_SWEEP_THRESHOLD
      || pendingReviewNotices.size >= COUNTER_SWEEP_THRESHOLD
    if (sweepDue) {
      const isAlive = (id: SessionId): boolean => ctx.agents.get(id) !== undefined
      sweepDeadSessionEntries(cumulativeToolCalls, isAlive)
      sweepDeadSessionEntries(dispatchDigest, isAlive)
      sweepDeadSessionEntries(completionInjected, isAlive)
      sweepDeadSessionEntries(pendingCadenceReviews, isAlive)
      sweepDeadSessionEntries(pendingCadenceWarned, isAlive)
      sweepDeadSessionEntries(cadenceResetWarned, isAlive)
      sweepDeadSessionEntries(pendingReviewNotices, isAlive)
      // S2.2 (v37): the review-channel marks are keyed by session as well — a
      // session with no live agent can never execute another write.
      sweepReviewChannelSessions(id => ctx.agents.get(SessionId(id)) !== undefined)
    }
    void onTurnEnd(session, event)
  })

  /**
   * Settle the session's outstanding notice: drop the record and restart the counting window.
   *
   * The window restarts when the notice LEAVES — either the queue dropped it unrun (`discarded`) or
   * the turn that claimed it ended. The reset runs under the state lock and re-loads the persisted
   * record before zeroing (V24-04): the in-memory snapshot may be turns old by then, and writing it
   * back would roll a later turn's counters away.
   * @param sessionId - the session whose notice settled.
   * @param why - which exit settled it; carried into the warning only, the effect is the same.
   */
  const settleNotice = async (
    sessionId: SessionId,
    why: 'discarded' | 'turn-end' | 'delivery-no-inbox' | 'subagent-flush' | 'queue-lost',
  ): Promise<void> => {
    pendingReviewNotices.delete(sessionId)
    // D 组（可观测）：每一次结清都留下归因——窗口什么时候重开、因为什么，是这条链路最难看出的
    // 一件事。正常出口记 info；queue-lost 是「事件漏了一次」的异常，记 warn。
    // warn, not info: this family logs at warn everywhere, and the default host level drops info — the
    // one line that says WHY the window reopened was invisible on a real machine (E8).
    ctx.logger.warn(`dsh-evolution-review: the outstanding review notice settled (${why}) — the review window restarts`)
    const stateService = ctx.get('evolutionState')
    try {
      await withReviewStateLock(sessionId, async () => {
        const fresh = await stateService?.loadReviewState(sessionId)
        if (fresh === undefined || fresh === null) return
        fresh.turnsSinceMemory = 0
        fresh.turnsSinceSkill = 0
        await stateService?.saveReviewState(sessionId, fresh)
      })
    } catch (resetError) {
      if (!cadenceResetWarned.has(sessionId)) {
        cadenceResetWarned.add(sessionId)
        ctx.logger.warn(`dsh-evolution-review: the counting window could not be restarted after a settled review (${why}: ${resetError instanceof Error ? resetError.message : String(resetError)}) — the next boundary may deliver a repeat`)
      }
    }
  }

  /**
   * Fold one inbox notification into the session's outstanding-notice record.
   *
   * The platform emits these on the agent scope (plain `ctx.on` receives every agent's, which is
   * how the platform's own plugins consume them); the state machine lives in `review-notice.ts`,
   * so this only routes the payload and keeps the sweep honest.
   * @param kind - which notification arrived.
   * @param payload - the agent, the message and (for a claim) the owning turn.
   */
  const foldNoticeEvent = (
    kind: NoticeEventKind,
    payload: {
      agent: { session: { id: SessionId } }
      message: NoticeMessage
      turn?: number | undefined
    },
  ): void => {
    const sessionId = payload.agent.session.id
    const outcome = noticeAfter(pendingReviewNotices.get(sessionId), { kind, message: payload.message, turn: payload.turn })
    if (outcome.notice === undefined) pendingReviewNotices.delete(sessionId)
    else pendingReviewNotices.set(sessionId, outcome.notice)
    // 被队列丢弃（删除／取消／被替换）＝ 立刻结清，窗口从这里重新开始。
    if (outcome.settled) void settleNotice(sessionId, 'discarded')
  }

  ctx.on('agent/inbox/inserted', (payload) => { foldNoticeEvent('inserted', payload) })
  ctx.on('agent/inbox/claimed', (payload) => { foldNoticeEvent('claimed', payload) })
  ctx.on('agent/inbox/discarded', (payload) => { foldNoticeEvent('discarded', payload) })

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
    if (!params().reviewEnabled) return
    if (session.header.origin === 'subagent') return
    if (branchSessions.has(session.id)) return
    if ((session.header as { visibility?: 'background' }).visibility === 'background') return
    const agent = ctx.agents.get(session.id)
    if (!agent) return
    // 0.2.x: the turn window comes from the family's `evolutionSignals` projection — the same
    // `foldTurnEvent` fold, driven once per committed event and reset at `turn/start` — instead of
    // re-reading the session log at every boundary.
    const signal = sessionTurnSignals(ctx, session)
    if (signal === undefined) {
      // The session view is not foldable (a structural stub, or a host without the registry):
      // there is no measurement, and an unmeasured boundary must not advance the cadence.
      ctx.logger.warn('dsh-evolution-review: the session cannot be projected (no evolutionSignals state) — this turn is not counted')
      return
    }
    // R7 (v35): no cast — the evolution-state module augmentation types this
    // service, so the hand-written shape (and its drift risk) is gone.
    const stateService = ctx.get('evolutionState')
    if (!stateService && !statelessReviewStateWarned) {
      statelessReviewStateWarned = true
      ctx.logger.warn('dsh-evolution-review: evolution-state service not mounted — memory/skill review cadence is not persisted and resets every turn (see README Known Limitations).')
    }
    // P3-5 (v14): `lastTurn: -1` is an IN-MEMORY sentinel only — it makes the
    // first `advanceReview` always count (a PERSISTED record requires
    // lastTurn >= 0 in both providers). The save below always runs after
    // `advanceReview`, which overwrites it, so the sentinel never reaches disk.
    // V24-04 (v24): the load → advance → save sequence (and the completed-
    // flush counter reset further down) run under a per-session state lock.
    // Two turn-end handlers of the SAME session can overlap — turn N's
    // completed-flush pipeline awaits the subagent review (minutes) while turn
    // N+1 ends — and the unlocked read-modify-write let the flush's STALE
    // snapshot overwrite turn N+1's already-saved counters (lost cadence
    // accumulation, lastTurn rolled back). The lock is the same per-key
    // promise-chain primitive the io seam uses (core serial.ts); unlike a
    // full pipeline serialization it only covers the state RMW, so fold
    // windows and review timing are unchanged.
    const snapshot = policy()
    // B 组（未结窗口）：取走本插件通知的那个回合不计数——它跑的是我们自己的复查（V7-02：那种回合
    // 唯一的实质输入就是我们的提示词，interval=1 下再触发一次就是自我连锁），窗口在这个回合结束时
    // 重新开始（settle 清零）。另一个出口是「被队列丢弃」，在 foldNoticeEvent 里立刻结清。
    // 认的是那条消息本身（记录里的 turn 等于本回合号），不是「投递后第一个结束的回合」——忙期里
    // 晚结束的旧回合因此不会误吞抑制（S2-9）。回合号按会话递增，所以「本回合号已越过记录里那个」
    // 只可能是那次 turn/end 没被我们看到：同样结清（宁可少算一个回合，也不能让闸门永久关着）。
    const outstanding = pendingReviewNotices.get(session.id)
    const settlesHere = outstanding !== undefined && outstanding.turn !== null && event.data.turn >= outstanding.turn
    let state: ReviewState = { turnsSinceMemory: 0, turnsSinceSkill: 0, lastTurn: -1 }
    // V24-04 (v24): the advanceReview result lives in a holder so the
    // control-flow analysis (which cannot see the lock-callback's assignment,
    // the same reason the v22 drift flag is a holder) does not narrow it to
    // the literal `null` initializer.
    const advanced: { kind: ReviewKind | null } = { kind: null }
    if (settlesHere) {
      await settleNotice(session.id, 'turn-end')
    } else await withReviewStateLock(session.id, async () => {
      state = await stateService?.loadReviewState(session.id) ?? { turnsSinceMemory: 0, turnsSinceSkill: 0, lastTurn: -1 }
      advanced.kind = advanceReview(state, event.data.turn, signal, {
        memoryInterval: params().reviewMemoryInterval,
        skillInterval: params().reviewSkillInterval,
        // V27 G2.4: the fallbacks are the SAME core constants the policy schema
        // defaults to — a bare 3/200/500 here silently diverged the moment the
        // policy default changed (a snapshot-less deployment kept the old bar).
        substantiveMinToolCalls: snapshot?.substantiveMinToolCalls ?? DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS,
        substantiveMinUserChars: snapshot?.substantiveMinUserChars ?? DEFAULT_SUBSTANTIVE_MIN_USER_CHARS,
        substantiveMinAgentChars: snapshot?.substantiveMinAgentChars ?? DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS,
        // 0.3.40 (user decision): the counting window restarts at the INJECTION —
        // the counters stay monotonic across threshold fires and are zeroed at
        // the flush below (one injection per task segment regardless of how many
        // thresholds fired before the task ended).
        resetOnFire: false,
      })
      await stateService?.saveReviewState(session.id, state)
    })
    const kind = advanced.kind
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
        if (params().reviewMode === 'branch' && await tryBranchReview(session, agent, pendingKind, signal as { toolCalls: number; userChars: number; assistantChars: number }, 'cadence')) {
          return
        }
        if (params().reviewMode === 'inject' || params().reviewMode === 'branch') {
          // 0.3.73: a refused delivery restores the latch and returns BEFORE the
          // reset below, so the segment's review retries instead of vanishing.
          if (!deliverMessage(agent, reviewPrompt(pendingKind), cadenceSummary(pendingKind), true)) {
            pendingCadenceReviews.set(session.id, pendingKind)
            return
          }
          // V24-15 (v24): the inject-mode cadence delivery previously did
          // NOT emit `review-scheduled` — on the default inject-mode
          // deployment a consumer would have missed every cadence review.
          // Same protection domain as the emit below.
          emitReviewScheduled(ctx, {
            sessionId: session.id,
            kind: pendingKind,
            toolCalls: signal.toolCalls,
            userChars: signal.userChars,
            assistantChars: signal.assistantChars,
            channel: 'inject',
          })
        }
        // B 组：这里不再清零。计数窗口由「未结通知」的生命周期驱动——被队列丢弃时立刻结清，
        // 或被取走的那个回合结束时结清（`settleNotice`）；投递本身不再是窗口的起点。
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
    // B-3 (v18) 在未结窗口下的等价形式：取走我们那条通知的回合既不 fire 节奏通道（上面走的是
    // settle 分支，advance 根本没跑），也不许落到完成通道——那是 V10-13 保护的同一个「一处边界
    // 两次复查」。
    if (settlesHere) return
    // Cadence waited; the completion channel fires once per session after a
    // task the conversation has proven long (cumulative tool-call threshold),
    // so short conversations are never adapted to at the cost of long ones.
    // P2-12 (v12): the completion channel previously injected directly,
    // bypassing deliverMessage — reviewWakeInject did not apply and the woken
    // turn's cadence fire was not suppressed. It now shares the waking
    // followup-first channel with every other review delivery.
    const trigger = params().skillReviewTrigger
    if (trigger !== 'completion' && trigger !== 'both') return
    if (completionInjected.has(session.id)) return
    if (!shouldCompletionReview(event.data.reason, cumulative, params().skillReviewCompletionMinToolCalls)) return
    completionInjected.add(session.id)
    if (params().reviewMode === 'branch' && await tryBranchReview(session, agent, 'skill', signal as { toolCalls: number; userChars: number; assistantChars: number }, 'completion')) {
      return
    }
    // V4-21 (F-334 residual ②) / 0.3.73: the flag is set BEFORE the delivery, so a
    // refused delivery must roll it back — otherwise this session's one
    // completion review is permanently lost in-process (the flag is in-memory
    // state, not durable).
    if (!deliverMessage(agent, COMPLETION_SKILL_REVIEW_PROMPT, 'completion review', true)) {
      completionInjected.delete(session.id)
      return
    }
    // G4.4 (F-334): emit the schedule confirmation only after the completion
    // review inject actually dispatches (E-41 ordering: record-schedule once the
    // review was truly sent, not before a dispatch that may fail).
    // V8-03 (0.3.48): protection domain (same as the flush emit above) — the
    // weaker form: the inject already happened, so a throwing listener only
    // surfaces a spurious review-error, but the family discipline applies.
    emitReviewScheduled(ctx, {
      sessionId: session.id,
      kind: 'skill',
      toolCalls: signal.toolCalls,
      userChars: signal.userChars,
      assistantChars: signal.assistantChars,
      // V24-15 (v24): the emitting delivery path, per the unified contract.
      channel: 'completion',
    })
  }

  /** V7-03 (0.3.42): shared waking delivery — review prompts AND result
   * notices go through the same followup-first channel (skip the woken turn's
   * cadence fire once, degrade to inject when reviewWakeInject is off or the
   * host lacks followup).
   *
   * 0.3.73: returns false when the host refused the delivery, and never throws.
   * Callers that own a one-shot latch or the cadence reset MUST honour the
   * result: the pre-0.3.73 form read `agent.followup` into a local and called
   * the detached reference, so EVERY real delivery threw
   * `TypeError: … reading 'send'` inside the platform's ReactLoopAgent (a
   * prototype method), the caller's catch demoted that to a console warning,
   * and the cadence reset ran anyway — the segment's review was consumed with
   * nothing queued (silent no-delivery window: 2026-09-07 → 0.3.73). */
  /**
   * S2-8 (FLOW1-3): is a HUMAN message already queued ahead of ours? The
   * review-channel mark is a session-level WINDOW, not a claim on one message:
   * if a real user message is pending when the review prompt is delivered, the
   * platform claims that human turn first and the mark would be in effect for
   * the user's own writes — attributing them `background_review` (the pinned /
   * hermes-managed protection would cover human edits). The platform exposes no
   * claim identity to the plugin, so the pre-claim queue is the identity that is
   * readable; this is the plan's documented fallback, and it only ever WITHHOLDS
   * the mark (a host without `inbox` behaves exactly as before).
   */
  const humanQueuedAhead = (inbox: InboxLike | undefined): boolean =>
    [...(inbox?.nextTurn ?? []), ...(inbox?.nextStep ?? [])].some(row => row.source?.kind === 'user')

  /** The one pending row that is a notice of ours, if the host's queue holds one. */
  const queuedNotice = (inbox: InboxLike | undefined): PendingMessageLike | undefined =>
    [...(inbox?.nextTurn ?? []), ...(inbox?.nextStep ?? [])].find(row => isReviewNotice(row))

  /**
   * D 组（兜底）：is one of our notices still outstanding? The record is in-memory, the queue is
   * durable, so the queue is read here as well — it is the only account that survives a restart or
   * a mount that missed the live events.
   *
   * Two directions have to hold. A queue holding one of our notices with no record means the review
   * is still waiting (rebuild the record; the `claimed`/`discarded`/`turn/end` pairing then works
   * as usual). A record saying "still queued" while the queue no longer holds that message means the
   * notice left without us seeing the event — settle it, or the gate would stay shut for good.
   * @param sessionId - the session whose window is judged.
   * @param inbox - the agent's pending-message view; without one the record is all there is.
   * @returns true while this session must not be asked for another review.
   */
  const noticeIsOutstanding = (sessionId: SessionId, inbox: InboxLike | undefined): boolean => {
    const record = pendingReviewNotices.get(sessionId)
    const queued = queuedNotice(inbox)
    if (record === undefined) {
      if (queued === undefined) return false
      pendingReviewNotices.set(sessionId, { messageId: queued.id, turn: null })
      return true
    }
    // A claimed notice is outstanding until the turn that took it ends — the queue no longer holds
    // it, so only the record can answer.
    if (record.turn !== null) return true
    if (queued !== undefined && queued.id === record.messageId) return true
    void settleNotice(sessionId, 'queue-lost')
    if (queued === undefined) return false
    pendingReviewNotices.set(sessionId, { messageId: queued.id, turn: null })
    return true
  }

  /** Mark the delivered review prompt's session — unless human input is queued
   * ahead of it (see humanQueuedAhead). Says so once per mount: an unmarked
   * window silently downgrades that review's writes to foreground attribution. */
  const markReviewChannelForDelivery = (agent: import('@deepseek-ai/dsh-agent').Agent, inbox: InboxLike | undefined): void => {
    if (humanQueuedAhead(inbox)) {

      if (!channelMarkSuppressedWarned) {
        channelMarkSuppressedWarned = true
        ctx.logger.warn('dsh-evolution-review: the review prompt was delivered BEHIND queued human input — the review-channel mark stays unset for this window, so this review\u2019s writes are attributed foreground and the .pinned/.hermes-managed protection does not cover them')
      }
      return
    }
    markReviewChannel(agent.session.id)
  }

  const deliverMessage = (agent: import('@deepseek-ai/dsh-agent').Agent, text: string, summary: string, reviewPrompt = false): boolean => {
    const wake = agent as { followup?: (message: unknown) => void }
    const inbox = (agent as { inbox?: InboxLike }).inbox
    // Result notices only. A review PROMPT is the review itself in inject mode; suppressing it
    // would silently cancel the work, so `reviewNotice` never touches `reviewPrompt === true`.
    // Returning true means the notice was deliberately handled (no queue, no retry latch).
    if (!noticeAllowed(reviewPrompt, params().reviewNotice)) {
      ctx.logger.info(`dsh-evolution-review: suppressed a result notice (${summary}) — reviewNotice is off`)
      return true
    }
    // C 组（未结窗口）+ D 组（兜底）：本会话已经有一条未结的复查通知——队列里还排着它（`turn === null`），
    // 或者取走它的那个回合还没结束——就不再投第二条。旧实现靠「同 kind 就就地替换」收敛重复，代价是
    // 被换掉的那条还要补一个唤醒桩；现在直接不投：那条还没跑完，接着再投只会让模型连着做两次复查。
    // 判断走 noticeIsOutstanding：记录缺失时按队列重建，队列里已经没有记录那条时按结清处理，闸门
    // 因此不会因为一次漏掉的事件而永久关着。只作用于复查提示：结果通知是另一回事，必须照发。
    if (reviewPrompt && noticeIsOutstanding(agent.session.id, inbox)) {
      if (!reviewNoticeOutstandingWarned) {
        reviewNoticeOutstandingWarned = true
        ctx.logger.warn('dsh-evolution-review: this session already has an outstanding review notice (still queued, or claimed by a turn that has not ended) — no second prompt is queued; the review runs when that one settles')
      }
      // false ＝「这次什么都没排」：调用方据此回滚它的一次性闩锁/完成标记（true 会让它以为投递成功，
      // 于是立刻再 emit 一次 review-scheduled，把一次复查记成 N 次）。等那条通知结清后的下一个边界再投。
      return false
    }
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      // T3-01/A29: a RESULT notice is not a review prompt — its `inserted` event must not be adopted
      // as an outstanding notice (that used to refuse the next cadence flush). The platform types this
      // `form` as the literal 'notice' (it is the platform's own announcement slot), so the
      // discriminator is the SUMMARY: review-notice.ts refuses the result summary by name.
      source: { kind: 'evolution-review', form: 'notice', summary },
    })
    // The wake primitive is called ON the agent: the platform Agent's
    // `followup` is a prototype method (`this.send(...)`), so a detached
    // reference loses its receiver. Bound arrow stubs in tests cannot show it.
    try {
      if (params().reviewWakeInject && typeof wake.followup === 'function') {
        wake.followup(message)
      } else agent.inject(message)
      // S2.2 (v37): a review PROMPT makes this session the autonomous review
      // channel (a result notice does not — nothing acts on it); the mark is
      // what tool-skill-manage reads for `.pinned`/`.hermes-managed`.
      if (reviewPrompt) markReviewChannelForDelivery(agent, inbox)
      // 没有 inbox 的宿主上没有任何队列事件可观察 ⇒ 退回改动前的行为：投递即结清。
      if (reviewPrompt && inbox === undefined) void settleNotice(agent.session.id, 'delivery-no-inbox')
      return true
    } catch (error) {
      ctx.logger.warn(`dsh-evolution-review: review delivery failed (${error instanceof Error ? error.message : String(error)}) — nothing was queued; the review is NOT consumed and retries at the next completed boundary`)
      return false
    }
  }

  const BRANCH_MEMORY_PROMPT = '[Auto-review — Memory] Review the conversation above and save durable user preferences, corrections, or stable facts with the memory tool when appropriate. Do not create skills here. Return a short summary of what was saved, or say Nothing to save.'

  async function tryBranchReview(session: Session, agent: import('@deepseek-ai/dsh-agent').Agent, kind: ReviewKind, signal: { toolCalls: number; userChars: number; assistantChars: number }, reason: 'cadence' | 'completion'): Promise<boolean> {
    const state = branchRunning.get(session.id)
    if (state !== undefined) { state.rerun = kind; return true }
    const branchState: { rerun?: ReviewKind } = {}
    branchRunning.set(session.id, branchState)
    const childId = SessionId('session-' + randomUUID())
    const startedAt = Date.now()
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, rawConfig.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS)
    let handle: Awaited<ReturnType<typeof ctx.agents.create>> | undefined
    try {
      const presets = ctx.get('agentPresets') as { resolve(id?: string): Promise<{ id: string }>; mount(target: Context, id?: string): Promise<unknown> } | undefined
      let agentPreset: string | undefined
      let setup: ((target: Context, child: import('@deepseek-ai/dsh-agent').Agent) => Promise<void>) | undefined
      if (presets !== undefined) {
        const resolved = await presets.resolve(session.header.agentPreset)
        agentPreset = resolved.id
        setup = async (target, _child) => { await presets.mount(target, resolved.id) }
      }
      const seed = session.snapshotEvents()
      const current = (ctx.get('agentDefaultModel') as { currentSelection?: () => { provider: string; model: string } } | undefined)?.currentSelection?.()
      handle = await ctx.agents.create({
        sessionId: childId,
        parentAgent: agent,
        seed,
        inheritedEventCount: SessionLogOffset(seed.length),
        meta: { parentSession: session.id, isSeeded: true, ...(agentPreset === undefined ? {} : { agentPreset }) },
        ...(current === undefined ? {} : { agentOptions: { provider: current.provider, model: current.model } }),
        ...(setup === undefined ? {} : { setup }),
      })
    } catch (error) {
      clearTimeout(timer)
      branchRunning.delete(session.id)
      ctx.logger.warn('dsh-evolution-review: branch Session did not start: ' + (error instanceof Error ? error.message : String(error)))
      return false
    }
    branchSessions.add(childId)
    const collected = { finalText: '', actions: [] as { type: 'skill' | 'memory' | 'tool'; action: string; target: string; status: 'ok' | 'error' }[], usage: undefined as { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | undefined, error: undefined as string | undefined }
    const onEvent = (owner: { id: SessionId }, event: SessionEvent): void => {
      if (owner.id !== childId) return
      if (event.type === 'tool/call') collected.actions.push({ type: 'tool', action: 'call', target: event.data.name, status: 'ok' })
      if (event.type === 'assistant/message') {
        const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
        if (text !== '') collected.finalText = text
        if (event.data.usage !== undefined) collected.usage = { inputTokens: event.data.usage.inputTokens ?? 0, outputTokens: event.data.usage.outputTokens ?? 0, cacheReadTokens: event.data.usage.cacheReadTokens ?? 0, cacheWriteTokens: event.data.usage.cacheWriteTokens ?? 0 }
      }
    }
    const offEvent = ctx.on('session/event', onEvent)
    emitReviewScheduled(ctx, { sessionId: session.id, kind, toolCalls: signal.toolCalls, userChars: signal.userChars, assistantChars: signal.assistantChars, channel: 'branch' })
    void (async () => {
      try {
        const prompt = kind === 'memory' ? BRANCH_MEMORY_PROMPT : COMPLETION_SKILL_REVIEW_PROMPT
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
        await handle.agent.whenIdle()
        offEvent()
        if (collected.finalText.trim() !== '') deliverMessage(agent, collected.finalText, 'branch review result', false)
        try {
          ctx.emit('evolution/review-completed', { version: 1, reviewId: childId, sessionId: session.id, branchSessionId: childId, kind, status: collected.error !== undefined ? 'failed' : timedOut ? 'timeout' : controller.signal.aborted ? 'aborted' : 'completed', trigger: { reason, toolCalls: signal.toolCalls, userChars: signal.userChars, assistantChars: signal.assistantChars }, finalText: collected.finalText, actions: collected.actions, ...(collected.usage === undefined ? {} : { usage: collected.usage }), startedAt, finishedAt: Date.now(), ...(collected.error === undefined ? {} : { error: collected.error }) })
        } catch (emitError) { ctx.logger.warn('dsh-evolution-review: review-completed emit failed: ' + (emitError instanceof Error ? emitError.message : String(emitError))) }
      } catch (error) {
        offEvent()
        collected.error = error instanceof Error ? error.message : String(error)
        ctx.logger.warn('dsh-evolution-review: branch review failed: ' + collected.error)
      } finally {
        clearTimeout(timer)
        branchSessions.delete(childId)
        await handle.dispose().catch(() => {})
        const rerun = branchState.rerun
        branchRunning.delete(session.id)
        if (rerun !== undefined) void tryBranchReview(session, agent, rerun, signal, reason)
      }
    })()
    return true
  }

  ctx.effect(() => () => {
    // T3-09/A37: unload cancels this fiber's long work FIRST — the subagent leg sees an aborted
    // signal, and the write leg stops at its next op boundary instead of landing writes for a
    // plugin instance that no longer exists (the HMR-reload window the author already recorded for
    // the deferred queue, now closed for the run that is actually in flight).
    // V7-16 (0.3.44) hand-listed these clears because the 0.3.38-0.3.42
    // additions were missing from the list. S2-2 clears what registered at its
    // declaration instead: one collection, one registration, and
    // tests/session-state-ownership.spec.ts fails when a new per-session map
    // skips the registry. reviewStateLocks chains self-remove when drained;
    // this clear only covers locks still pending at unload.
    sessionState.dispose()
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
/**
 * v35 C9: the staging anchor of one accepted plan op, in the shape the library
 * verifies against the bytes it reads under the write's own lock. The `absent`
 * sentinel is the same one the tool's staging attaches for a support file that
 * did not exist when the plan was produced.
 * The staged field rides OUTSIDE the plan schema (the staging channel attaches
 * it to the op payload), so it is read defensively rather than typed on SkillOp.
 * @param op - one accepted plan op.
 * @returns the anchor, or `undefined` when the op carries none.
 */

/**
 * Translate the library's anchor refusal into this channel's staging wording.
 * The library reports WHICH drift it saw (drift / missing / unverifiable); the
 * vocabulary ("this plan was produced", "produce a fresh plan") is the review
 * channel's. A body op whose skill vanished keeps the historical not-found
 * report: the former lock-free check only refused on a DRIFTED body, so a
 * deleted target fell through to the write's own not-found result.
 * @param result - the library's stale result.
 * @param name - the skill the op targets.
 * @param filePath - the support-file path for file ops; omitted for body ops.
 * @returns the refusal to return from the direct path.
 */


/** Map/set size that triggers a dead-session counter sweep (bounded, not a hard cap). */
const COUNTER_SWEEP_THRESHOLD = 128

/**
 * Dispatch frames kept per session for the review digest.
 *
 * The digest renders at most 12 tool lines and pairs a result with the call that opened it, so 128
 * frames (≈64 dispatches) is far more than the renderer can spend — and unlike the whole-log scan it
 * replaced, the memory this holds is bounded per session rather than proportional to the log.
 */
const DISPATCH_DIGEST_FRAMES = 128

/** One dispatch frame the review digest can render (a native call/result or a PTC sub-dispatch). */
interface ReviewDispatchFrame {
  readonly type: string
  /** Session seq of the frame, so a plan can cite a real `event_seq`. */
  readonly seq?: number
  readonly data?: unknown
}

/**
 * Keep one dispatch-relevant frame in a session's bounded digest.
 *
 * A frame is kept when the family's dispatch vocabulary recognizes it as opening a dispatch
 * (`readDispatchSignal`) or as answering one (`resultCallIdOf`) — the two shapes the digest renders.
 * Everything else (message frames, boundaries, chunks) is not evidence and is not copied.
 * @param digest - the per-session digest map.
 * @param id - the owning session.
 * @param event - the committed session event.
 */
function appendDispatchFrame(
  digest: Map<SessionId, ReviewDispatchFrame[]>,
  id: SessionId,
  event: { type: string; seq?: number; data?: unknown },
): void {
  if (readDispatchSignal(event) === null && resultCallIdOf(event) === null) return
  const frames = digest.get(id) ?? []
  frames.push({ type: event.type, ...event.seq === undefined ? {} : { seq: event.seq }, ...event.data === undefined ? {} : { data: event.data } })
  if (frames.length > DISPATCH_DIGEST_FRAMES) frames.splice(0, frames.length - DISPATCH_DIGEST_FRAMES)
  digest.set(id, frames)
}

/**
 * Remove every entry whose session is no longer live (rc.42 audit P1-10):
 * `cumulativeToolCalls` / `completionInjected` / `pendingCadenceReviews` are keyed by
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
 * The call one log event ANSWERS, in either platform vocabulary.
 *
 * A native tool-result event names its call inside the message (`message.source`,
 * the shape `createToolResultMessage` produces — llm/src/message.ts:258), and a
 * PTC settle event carries `isError` plus the outcome `content` on its own
 * payload. Classified structurally, from the payload, so this file never
 * discriminates on a dispatch event type (arch guard N11).
 * @param event - one persisted session event.
 * @returns the answered call id, or `null` when the event carries no outcome.
 */
function resultCallIdOf(event: { type?: string; data?: unknown } | undefined): string | null {
  const data = event?.data as { message?: { source?: { callId?: unknown } }; subCallId?: unknown; isError?: unknown } | null | undefined
  if (data === undefined || data === null) return null
  const native = data.message?.source?.callId
  if (typeof native === 'string') return native
  if (typeof data.subCallId === 'string' && typeof data.isError === 'boolean') return data.subCallId
  return null
}
