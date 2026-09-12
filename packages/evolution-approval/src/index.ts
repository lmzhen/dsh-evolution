/**
 * Stage/pending write approval for self-evolution mutations.
 *
 * DSH's native approval seam is one-shot only. This service adds the
 * Hermes-style staged queue: a write whose ORIGIN is the background review —
 * or a foreground write while `stageForeground` is on — is recorded in
 * `ctx.evolutionState`, and a human approves or rejects it later. The CURATOR
 * does NOT route through this queue: it owns its own gate set and writes
 * directly (batch/consolidate), so "curator writes are staged" is not a
 * property of this service (V27 G6.2; see evolution-curator's gate set for what
 * actually constrains an autonomous curator write). A runner
 * registry replays the exact mutation without passing through the gate a
 * second time. Resolved records are kept as audit history up to
 * PENDING_RESOLVED_CAP (the most recent N; the state provider archives the
 * older ones to pending-state-archive.json).
 *
 * @module @deepseek-ai/dsh-evolution-approval
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { PendingKind, PendingRecord, PendingStatus } from '@deepseek-ai/dsh-evolution-state-storage'
import type { EvolutionState } from '@deepseek-ai/dsh-evolution-state'

export type { PendingKind, PendingRecord, PendingStatus }

export type WriteRunner = (args: unknown) => Promise<{ ok: boolean; message: string }>

export interface ApprovalRequest {
  kind: PendingKind
  summary: string
  args: unknown
  origin: 'foreground' | 'background_review'
  /**
   * The requesting session's effective approval policy (platform vocabulary:
   * 'ask' | 'never' — see `dsh-user-approval`). When 'never', the session has
   * declared the deterministic unattended stance (CI, cron, automated runs),
   * so the write is allowed instead of staging an unanswerable pending record
   * (claw alignment: "skip approval for non-interactive contexts"). Absent
   * (no session / no approval service) keeps the previous behavior.
   *
   * V27 G6.2: this field is a FALLBACK, not the authority. With the platform
   * `approval` service mounted, `request()` derives the policy from it
   * (`overrideOf` → deployment `config.policy` → 'ask') and ignores this value
   * entirely; it is read only in assemblies WITHOUT that service. A caller
   * holding the session object must pass it as `session`: a bare `sessionId`
   * cannot be probed (the platform resolves the override from the object's
   * session log view).
   */
  sessionPolicy?: 'ask' | 'never'
  /** 0.3.17 (E-25): the requesting session id, kept on the record for
   * audit attribution (staged AND resolved history). */
  sessionId?: string
  /** 0.3.40 (V6-27 fix): the requesting SESSION OBJECT. The platform
   * `approval.overrideOf(session: Session)` needs the session's log view —
   * `session.events` before 0.1.5, `session.snapshotEvents()` from 0.1.5 on —
   * so a bare id string throws in the real implementation (a missing log view
   * reads as `undefined.length`). Callers that hold the session
   * (model tools, review pipeline) MUST pass it so the session-level override
   * (`approval/policy` event) is honored; absent falls back to the id probe
   * (undefined for platform lookups) + the config chain. */
  session?: unknown
}

export interface ApprovalDecision {
  action: 'allow' | 'staged'
  pendingId?: string
  message: string
}

/** 0.3.19 (W1.2): the ONE consumer-facing shape of the approval seam. Every
 * package that probes `ctx.get('evolutionApproval')` imports this instead of
 * declaring a local sub-interface (previously 5 duplicated local views that
 * drifted — the learning-graph one omitted isEnabled, commands' used a wider
 * status union). Optional members stay optional: capabilities that need the
 * fail-closed distinction read `isEnabled`, others may ignore it. */
export type ApprovalLike = {
  request(input: ApprovalRequest): Promise<ApprovalDecision>
  run(kind: PendingKind, args: unknown, intent?: { interface: 'background_review' }): Promise<{ ok: boolean; message: string }>
  hasRunner(kind: PendingKind): boolean
  isEnabled?: boolean
  /** P3 (v16): whether foreground-origin writes stage (learning-graph's
   * hasRunner pre-check reads it so it only refuses writes that would
   * actually be staged). Optional: absent means "unknown" and callers must
   * not pre-refuse on it. */
  stageForeground?: boolean
  registerRunner(kind: PendingKind, runner: WriteRunner): () => void
  list(status?: PendingStatus): Promise<PendingRecord[]>
  approve(id: string): Promise<{ ok: boolean; message: string }>
  reject(id: string): Promise<{ ok: boolean; message: string }>
}

/** 0.3.23 (G4.8): the shape of the platform approval-policy probe that the
 * two in-file readers below cast to. v20 (B-1): no longer exported — a
 * monorepo-wide grep found zero external consumers (the tools import
 * `effectiveSessionPolicy` only), so the former "ONE shared shape" docblock
 * overstated its reach. `config` stays optional-typed at the READ sites
 * because the runtime platform service can be a bare stub without it. */
interface ApprovalPolicyLike {
  overrideOf(session: unknown): 'ask' | 'never' | undefined
  config: { policy?: 'ask' | 'never' }
}

/** The requesting session's effective policy (override ?? configured default);
 * undefined when the approval service is not mounted or no session is
 * available — callers keep their previous behavior. Single source (G4.8,
 * F-341): the model tools each copied this helper; it lives here now. */
export function effectiveSessionPolicy(ctx: Context, session: unknown): 'ask' | 'never' | undefined {
  const approval = ctx.get('approval') as ApprovalPolicyLike | undefined
  if (!approval || session === undefined) return undefined
  // v20 (B-1): same optional-shape read as `deriveSessionPolicy` below — the
  // config field is optional at runtime (a bare platform stub), and the
  // former direct `approval.config.policy` deref turned a stub into a
  // TypeError on every caller (each /graph write probes this helper).
  return approval.overrideOf(session) ?? (approval as Partial<ApprovalPolicyLike>).config?.policy ?? 'ask'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionApproval: EvolutionApproval
  }
}

export interface Config {
  /** Master switch. Default false matches Hermes write_approval default. */
  enabled?: boolean
  /** Require approval for foreground writes as well. */
  stageForeground?: boolean
}

export class EvolutionApproval extends Service {
  static inject = ['evolutionState']
  static Config: Schema<Config> = z.object({
    enabled: z.boolean().default(false),
    stageForeground: z.boolean().default(true),
  })

  private readonly enabled: boolean
  private readonly stageForegroundConfig: boolean
  /** P3 (v16): public read for staging pre-checks (learning-graph refuses a
   * stage that no runner could replay only when foreground writes stage at
   * all). Mirrors `this.stageForeground`. */
  get stageForeground(): boolean {
    return this.stageForegroundConfig
  }
  private readonly runners = new Map<PendingKind, WriteRunner>()
  private readonly inFlight = new Map<string, Promise<{ ok: boolean; message: string }>>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionApproval')
    this.enabled = config.enabled ?? false
    this.stageForegroundConfig = config.stageForeground ?? true
  }

  private state(): EvolutionState {
    return this.ctx.evolutionState
  }

  /** Fail-closed capability adapters need to distinguish "allowed" from "enabled". */
  get isEnabled(): boolean {
    return this.enabled
  }

  registerRunner(kind: PendingKind, runner: WriteRunner): () => void {
    // P3 (v3 audit): a duplicate kind would silently shadow the first runner
    // (mirroring EvolutionStateStorageRegistry.registerProvider, which throws).
    if (this.runners.has(kind)) throw new Error(`approval runner for "${kind}" is already registered`)
    this.runners.set(kind, runner)
    return () => {
      if (this.runners.get(kind) === runner) this.runners.delete(kind)
    }
  }

  /**
   * Whether a replay runner is registered for `kind` (rc.42 audit P1-9
   * pre-check surface): callers that can execute a write directly (the review
   * pipeline) use it to avoid staging a pending record that no runner could
   * ever replay. `capability` records are answerable without a runner by
   * design, so they are exempt from the staging pre-check.
   */
  hasRunner(kind: PendingKind): boolean {
    return this.runners.has(kind)
  }

  /**
   * Trusted plan-executor entry point: replay a write through the registered
   * runner exactly once. 0.3.17 (S3.2, E-23): this is the BACKGROUND-REVIEW
   * replay channel only — the caller must declare the intent (the review
   * pipeline is the sole production consumer); a bare call is refused so the
   * staging boundary cannot be bypassed by accident from another surface.
   */
  async run(kind: PendingKind, args: unknown, intent?: { interface: 'background_review' }): Promise<{ ok: boolean; message: string }> {
    if (intent?.interface !== 'background_review') {
      return { ok: false, message: 'approval.run is the background-review replay channel; direct execution must use the tool path (staging is the only gate bypass for foreground).' }
    }
    const runner = this.runners.get(kind)
    if (!runner) return { ok: false, message: `No replay runner registered for kind "${kind}".` }
    return await runner(args)
  }

  /** Evaluate one mutation. Returns allow, or stores the write and returns staged. */
  async request(input: ApprovalRequest): Promise<ApprovalDecision> {
    const summary = normalizeSummary(input)
    if (!this.enabled) return { action: 'allow', message: 'Approval disabled.' }
    // 0.3.17 (S3.1, E-22): the session policy is DERIVED server-side from the
    // platform approval service when it is mounted (overrideOf is the platform
    // authority). The caller's self-reported sessionPolicy is honored ONLY in
    // assemblies WITHOUT the platform service — a tool can no longer claim
    // 'never' and bypass staging on its own. 0.3.40 (V6-27): the real platform
    // overrideOf resolves the policy from the session's log view
    // (`snapshotEvents()` from 0.1.5 on), so the SESSION object rides the request.
    const derived = this.deriveSessionPolicy(input.sessionId, input.session)
    const policy = derived ?? (this.ctx.get('approval') ? undefined : input.sessionPolicy)
    if (policy === 'never') {
      return { action: 'allow', message: 'Session approval policy is "never"; write allowed without staging.' }
    }
    if (input.origin === 'background_review' || this.stageForeground) {
      // Observability for the P1-9 trap (rc.42 audit): staging a memory/skill
      // write with no registered runner creates a pending record that no
      // approver could ever replay. Callers with a direct executor pre-check
      // `hasRunner`; this warn keeps any other caller's mistake visible.
      if (input.kind !== 'capability' && !this.runners.has(input.kind)) {
        this.ctx.logger.warn(`evolution-approval: staging "${input.kind}" write with no replay runner registered - it will not be approvable`)
      }
      const record: PendingRecord = {
        id: randomUUID(),
        kind: input.kind,
        summary,
        // V24-06 (v24): `args: undefined` passes the seam's clone gate but is
        // DROPPED by the json medium's JSON.stringify — the record would fail
        // the field gate on the next read, be quarantined, and this staged
        // write would silently vanish ("approve <id>" → "not in the pending
        // window"). Normalize the no-args case to `{}` so the record
        // round-trips through every medium. (The write gate now refuses
        // undefined too; this keeps `request` usable for the honest caller
        // that simply has no arguments.)
        args: input.args === undefined ? {} : input.args,
        createdAt: new Date().toISOString(),
        status: 'pending',
        // 0.3.17 (E-25): attribution was previously dropped at staging — the
        // audit history could not say WHERE a staged write came from.
        origin: input.origin,
        ...input.sessionId ? { sessionId: input.sessionId } : {},
      }
      await this.state().savePending(record)
      return {
        action: 'staged',
        pendingId: record.id,
        message: `Write staged for approval. Review with /evolution pending and approve ${record.id}.`,
      }
    }
    return { action: 'allow', message: 'Foreground write allowed.' }
  }

  async list(status: PendingStatus = 'pending'): Promise<PendingRecord[]> {
    return await this.state().listPending(status)
  }

  async approve(id: string): Promise<{ ok: boolean; message: string }> {
    return await this.dedupe(`approve:${id}`, () => this.doApprove(id))
  }

  async reject(id: string): Promise<{ ok: boolean; message: string }> {
    return await this.dedupe(`reject:${id}`, async () => {
      // Reject claims the record like approve does, so a pending write resolves
      // on a single gate (F-204). The executing-rescue branch below does NOT
      // hold a claim: an 'executing' record may be an approve runner still in
      // flight, and resolving it to 'rejected' without a claim can race that
      // runner (the write may land after reject; the audit then reads
      // rejected). This is a documented best-effort operator cleanup, not a
      // second resolution gate.
      const claimId = randomUUID()
      const record = await this.state().claimPending(id, claimId)
      if (!record) {
        // 0.3.17 (S3.3): operator cleanup for a crashed approve — rejecting an
        // 'executing' record resolves it WITHOUT running any runner (the write
        // may already have landed; approval never replays it). This branch does
        // NOT hold the claim (F-204): if the approve runner is genuinely still
        // in flight, the reject can race it, so the message is honest about the
        // write effect standing as-is.
        const stuck = (await this.state().listPending('executing')).find(item => item.id === id)
        if (stuck) {
          const resolution = await this.state().tryResolvePending(id, 'rejected')
          return resolution.applied
            ? { ok: true, message: `Rejected executing write "${id}" (no claim held — this may race an in-flight approve runner; if the write already landed its effect stands as-is. Verify the write state manually).` }
            : { ok: false, message: `Pending write "${id}" could not be rejected: it resolved concurrently.` }
        }
        // 0.3.28 (V4-18): the record was NOT found AND is not 'executing', so it
        // is no longer in the active window — either it was already resolved
        // (approved/rejected) and later rotated past PENDING_RESOLVED_CAP, or it
        // never existed. The old "already being resolved by another writer"
        // message mis-attributed a rotated/archived id to a live concurrent
        // writer (the cap rotation magnified it into a misleading claim).
        return { ok: false, message: `Pending write "${id}" is not in the pending window (rotated or resolved).` }
      }
      // P3 (v15): the claim is HELD here — pass it so a concurrent unscoped
      // writer cannot be stomped (same scoping the approve main path uses
      // since v14). The stuck-executing rescue above deliberately stays
      // unscoped (F-204: it holds no claim by design).
      const resolution = await this.state().tryResolvePending(id, 'rejected', claimId)
      if (!resolution.applied || !resolution.record) {
        // 0.3.17 (E-61): the claim stays HELD otherwise — the reject path was
        // asymmetric with approve (which releases on every failure branch).
        await this.state().releasePendingClaim(id, claimId)
        return { ok: false, message: `Pending write "${id}" is not pending (already resolved or missing).` }
      }
      return { ok: true, message: `Rejected ${resolution.record.kind} write "${id}".` }
    })
  }

  /**
   * 0.3.17 (S3.1): platform-side session policy derivation — the platform's
   * approval service (`overrideOf`) is the authority; a deployment-level
   * `config.policy` is the fallback (V6-27, 0.3.37: the deploy default used to
   * be ignored here, so a `policy: 'never'` deployment still staged writes for
   * sessions without an override — same chain as the exported
   * `effectiveSessionPolicy`, overrideOf ?? config.policy ?? 'ask'). The mount
   * check is lazy: the platform service can start before or after this plugin.
   */
  private deriveSessionPolicy(sessionId?: string, session?: unknown): 'ask' | 'never' | undefined {
    if (!sessionId && !session) return undefined
    const platformApproval = this.ctx.get('approval') as ApprovalPolicyLike | undefined
    if (!platformApproval) return undefined
    // 0.3.40 (V6-27): the platform overrideOf resolves the policy from the
    // session's log view — the SESSION OBJECT is required; a bare id string
    // throws a TypeError in the real implementation. Without a session object
    // we do NOT probe (the id would crash the real platform service) — the
    // config chain below stands.
    const override = session !== undefined ? platformApproval.overrideOf(session) : undefined
    if (override === 'never' || override === 'ask') return override
    // The config field itself is optional at runtime (a bare platform stub) —
    // read it through the optional shape.
    return (platformApproval as Partial<ApprovalPolicyLike>).config?.policy ?? 'ask'
  }

  private dedupe(id: string, task: () => Promise<{ ok: boolean; message: string }>): Promise<{ ok: boolean; message: string }> {
    const existing = this.inFlight.get(id)
    if (existing) return existing
    const run = task().finally(() => { this.inFlight.delete(id) })
    this.inFlight.set(id, run)
    return run
  }

  private async doApprove(id: string): Promise<{ ok: boolean; message: string }> {
    const claimId = randomUUID()
    const record = await this.state().claimPending(id, claimId)
    if (!record) {
      // 0.3.17 (S3.3, E-24): the claim was refused — either another writer is
      // resolving, or the record sits 'executing' (a previous approve may have
      // run then crashed). NEVER auto-replay an executing record: the write
      // may already have landed, and re-running it duplicates a non-idempotent
      // operation. Side effect (F-204): approve's stuck branch refuses WITHOUT
      // claiming, while reject's executing-cleanup resolves WITHOUT a claim, so
      // a concurrent reject can set an in-flight runner's record to 'rejected'.
      const stuck = (await this.state().listPending('executing')).find(item => item.id === id)
      if (stuck) {
        // V5-18 (0.3.31): the old message blamed "a previous approve may have
        // run before a crash" and directed the operator to reject — but the
        // executing state is also a CONCURRENT in-flight approve, and rejecting
        // that would kill a live run. Keep the honest attribution (the reject
        // side already had it) so a late approve is not steered into sabotage.
        return { ok: false, message: `Pending write "${id}" is executing — either another writer is resolving it right now, or a previous approve ran then crashed. If you did not start this approve, do not reject it (the in-flight run completes on its own); verify the effect instead. A genuinely stuck record (no runner activity) can still be rejected — /evolution pending shows it as EXECUTING.` }
      }
      // 0.3.28 (V4-18): as in reject, a non-executing miss is a rotated/archived
      // id, not a live concurrent writer — keep the attribution honest.
      return { ok: false, message: `Pending write "${id}" is not in the pending window (rotated or resolved).` }
    }
    const runner = this.runners.get(record.kind)
    if (!runner) {
      if (record.kind === 'capability') {
        // 0.3.66: the producer is gone (the adapter was removed), but a record
        // staged by a ≤0.3.65 install stays answerable — and answering it
        // records intent only, so nothing needs replaying.
        // P3 (v15): claim-scoped like the other paths — and when a concurrent
        // writer won the race, mirror the memory/skill divergence message
        // instead of a bare "already resolved".
        const resolution = await this.state().tryResolvePending(id, 'approved', claimId)
        if (!resolution.applied) {
          const rejected = (await this.state().listPending('rejected')).find(item => item.id === id)
          if (rejected) return { ok: false, message: `Capability "${id}" was approved, but the record was resolved to "rejected" concurrently — no code ran and nothing needs replaying; verify before re-submitting.` }
          return { ok: false, message: `Pending write "${id}" was already resolved by another writer.` }
        }
        return { ok: true, message: 'Capability approved for manual activation in Creator mode (no code was executed).' }
      }
      await this.state().releasePendingClaim(id, claimId)
      return { ok: false, message: `No replay runner registered for kind "${record.kind}".` }
    }
    try {
      const result = await runner(record.args)
      if (!result.ok) {
        await this.state().releasePendingClaim(id, claimId)
        // v32 REV-07: a replay that fails on staleness/not-found was usually
        // defeated by a SIBLING record from the same plan (an earlier approve
        // changed the target) — the record would deterministically fail every
        // retry. Name that, and point at reject as the way out, instead of
        // leaving a permanently un-approvable pending row.
        const deterministic = /changed since this plan|no entry matching|not found|no longer exists/i.test(result.message)
        return {
          ok: false,
          message: deterministic
            ? `${result.message} — a sibling write from the same plan may have already changed this target, so repeated approves will keep failing. Reject this record unless the target changed again.`
            : result.message,
        }
      }
    } catch (error) {
      await this.state().releasePendingClaim(id, claimId)
      this.ctx.logger.warn(error)
      return { ok: false, message: 'Replay runner failed; the pending write remains pending.' }
    }
    // v28 G1.3 (APPR-01): the resolve sits inside the same protection the
    // runner has — a thrown resolve (state-file quarantine, lock budget,
    // domain closed) used to escape as a raw exception AFTER the effect had
    // landed, hiding the landed write behind an exception and skipping the
    // divergence report the concurrent-reject branch below always provides.
    // The claim deliberately stays 'executing': that row is the operator's
    // verify-before-retry gate (approve refuses to re-run it).
    const resolution = await this.state().tryResolvePending(id, 'approved', claimId).catch((error: unknown) => {
      this.ctx.logger.warn(error)
      return `failed: ${error instanceof Error ? error.message : String(error)}`
    })
    if (typeof resolution === 'string') {
      return {
        ok: false,
        message: `Approved write "${id}" was replayed, but resolving the record failed (${resolution.slice('failed: '.length)}) — the effect has LANDED while the audit row stays "executing". Verify the write manually; approve will not re-run it.`,
      }
    }
    if (!resolution.applied) {
      // P2-2 (v14): the claim-scoped resolve refused, which means the record
      // left 'executing' under us — typically a concurrent operator reject
      // while the runner was still in flight. The write DID land (the runner
      // succeeded), so report the divergence instead of a bare "already
      // resolved": the operator must verify the effect, not re-approve.
      const rejected = (await this.state().listPending('rejected')).find(item => item.id === id)
      if (rejected) {
        return {
          ok: false,
          message: `Approved write "${id}" was replayed, but the record was resolved to "rejected" concurrently — the effect has landed while the audit reads rejected. Verify the write and do NOT replay it.`,
        }
      }
      return { ok: false, message: `Pending write "${id}" was already resolved by another writer.` }
    }
    // 0.3.17 (E-61): the success message names what was approved, not just
    // the kind — a reviewer acting on several batches can tell them apart.
    return { ok: true, message: `Approved ${record.kind} write "${id}" (${record.summary}).` }
  }
}

export default EvolutionApproval

/** Compact, batch-aware approval summary so pending lists stay scannable. */
function normalizeSummary(input: { kind: PendingKind; summary: string; args: unknown }): string {
  const trimmed = input.summary.length > 120 ? `${input.summary.slice(0, 117)}...` : input.summary
  if (input.kind === 'memory') {
    const candidate = input.args as { operations?: unknown[]; target?: string } | undefined
    if (Array.isArray(candidate?.operations) && candidate.operations.length > 1) {
      // F-329: a batch whose target defaulted to 'memory' used to render as
      // "memory memory batch of N operations". Only qualify the batch with the
      // target when it differs from the default, so the label stays single-word.
      const targetLabel = candidate.target ?? 'memory'
      const qualifier = targetLabel === 'memory' ? '' : `${targetLabel} `
      return `memory ${qualifier}batch of ${candidate.operations.length} operations`
    }
  }
  // P3-39 (v14): match the DELETE semantics, not one caller's prefix spelling —
  // learning-graph stages the same operation as "graph delete X" and used to
  // miss the archive warning that review's "skill delete X" got.
  // P3 (v15): anchor to the known command spellings so an add/patch whose
  // SUMMARY merely contains the word "delete" (e.g. `skill create how to
  // delete dupes`) is not mislabelled as an archiving operation.
  if (input.kind === 'skill' && /^(?:skill|graph)\s+delete\s/.test(trimmed)) return `${trimmed} (warning: archive)`
  return trimmed
}
