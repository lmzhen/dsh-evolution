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
import type { Fiber, Volatile } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
// v43 FLOW2-1: the orphan criterion needs ONE liveness rule. G2 S4 retired the io write-lock
// protocol this grammar was borrowed from, so the claim-id grammar and its pid probe live HERE —
// the only remaining user — instead of keeping a lock parser alive in core for a non-lock caller.
import { clampOnce, unwrapLive, type WriteConfirmMode } from '@deepseek-ai/dsh-evolution-core'
import z from '@deepseek-ai/schemastery'
import type { PendingKind, PendingRecord, PendingStatus } from '@deepseek-ai/dsh-evolution-state-storage'
import type { EvolutionState } from '@deepseek-ai/dsh-evolution-state'
import { makeApprovalRoutes } from './routes.ts'
import { registerHostRoutes } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { DecisionAudit } from '@deepseek-ai/dsh-evolution-core/http-routes'

/** A claim id carries its holder pid as `<pid>:<hex token>` (minted by `newClaimId()`). */
const CLAIM_ID_RE = /^(\d+):[0-9a-f]*$/

/**
 * @param claimId - an id from a record's `claimedBy` field.
 * @returns the holder pid, or null when the id does not have the claim shape (pre-v43 bare UUID).
 */
function claimHolderPid(claimId: string): number | null {
  const match = CLAIM_ID_RE.exec(claimId.trim())
  return match === null ? null : Number(match[1])
}

/**
 * Whether a pid can still be running. `kill(pid, 0)` is the POSIX/Windows probe: it sends no
 * signal and answers through the error — EPERM means the process EXISTS but is not ours.
 * @param pid - the holder pid from a claim id (callers guard `> 0`; there is no pid 0).
 * @returns true when the process exists.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export type { PendingKind, PendingRecord, PendingStatus }

export type WriteRunner = (args: unknown) => Promise<{ ok: boolean; message: string }>

/**
 * What one staged write WOULD store, resolved by the package that owns its replay.
 *
 * `available: false` is a business answer, not an error: plenty of staged writes have no bytes worth
 * showing (a request that carries no content, a target whose replay the host cannot resolve yet), and
 * the reader is owed the reason rather than an empty diff.
 */
export type PreviewAnswer =
  | {
    readonly available: true
    /** The artifact the bytes belong to, for the reader's label (a file name, or the skill name). */
    readonly path: string
    /** The bytes the replay would replace; null when the target does not exist yet. */
    readonly before: string | null
    /** The bytes it would write; null when the operation removes the target. */
    readonly after: string | null
    /** Additional files the operation writes or deletes (multi-root extract). */
    readonly files?: readonly { readonly path: string; readonly before: string | null; readonly after: string | null }[]
  }
  | { readonly available: false; readonly reason: string }

/**
 * Resolve one staged write's before/after WITHOUT running it.
 *
 * Registered beside the runner by the same package, and deliberately not derived from it: a preview
 * that re-derived the bytes would drift from what the replay writes, and the family's rule is that the
 * write path owns its own normalization (anchors, frontmatter quoting) — one home, two readers.
 */
export type WritePreview = (args: unknown) => Promise<PreviewAnswer>

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
  registerRunner(kind: PendingKind, runner: WriteRunner, preview?: WritePreview): () => void
  /** T4-09/A51: the staged window's effective expiry in ms, 0 = never. Optional for the same reason
   * the other reads are: an older/partial implementation simply does not answer, and a caller must not
   * read that absence as "expires immediately". */
  ttlMs?: number
  list(status?: PendingStatus): Promise<PendingRecord[]>
  approve(id: string): Promise<{ ok: boolean; message: string }>
  reject(id: string): Promise<{ ok: boolean; message: string }>
  /** S2-P2-22 (0.3.80): return an ORPHANED executing record (an approve that
   * crashed mid-run) to the pending window, so it can be deliberately
   * re-approved or rejected. v43 FLOW2-1: "orphaned" is DECIDED — from this
   * process's in-flight set AND the holder pid the record's claim carries — so a
   * claim naming a live foreign pid is REFUSED, and a claim without a pid is
   * released only as an explicitly destructive operator action. Optional: only
   * the real service implements it. */
  release?(id: string): Promise<{ ok: boolean; message: string }>
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
  enabled?: Volatile<boolean>
  /** Require approval for foreground writes as well. */
  stageForeground?: boolean
  /**
   * T4-09/A51: milliseconds after which a STAGED write expires. `0` (the default) means never —
   * the window then behaves exactly as before. Expiry closes the record the same way a reject does
   * (status `rejected`, `resolvedAt` stamped, runner NEVER invoked): an expiry is a cleanup of the
   * window, never an approval, so nothing a human did not approve can execute.
   *
   * `.volatile()` (0.21.0, G1): the field carries a USER LAYER, so the value arrives as a live
   * reference and is read at USE time — a settings write changes the window without a reload.
   */
  pendingTtlMs?: Volatile<number>
  /**
   * U-6: what the confirmation before an APPROVE does. The same three words the skill-write gate uses
   * (`WriteConfirmMode`, whose home is `evolution-core/src/write-authority.ts` - moved there with the
   * authority that carries it; the re-export from `write-gates.ts` was removed in G1/1.8) - and now the
   * IMPORT below is what makes that true: without it the docblock claimed an import the file did not have.
   */
  approvalConfirm?: Volatile<WriteConfirmMode>
}

export class EvolutionApproval extends Service {
  static inject = ['evolutionState']
  // No `Schema<Config>` annotation: a row carrying a `.volatile()` field does not satisfy it under
  // exactOptionalPropertyTypes (the schema's output type is required and the interface's property is
  // optional) — every other volatile-bearing row in the family declares the schema unannotated.
  static Config = z.object({
    enabled: z.boolean().default(false).volatile(),
    stageForeground: z.boolean().default(true),
    // 0 = never expire (the shipped default: the window is unbounded until the operator decides).
    // The schema floor keeps a negative TTL from meaning "everything is instantly stale".
    // `.volatile()` is what gives this field a USER LAYER (the platform projects only volatile
    // fields into a row's settings form — its `volatileForm` projection): without it the registry's
    // E3 row would document a knob no write can reach (G1, 0.21.0).
    pendingTtlMs: z.number().min(0).default(0).volatile(),
    // U-6: `auto` is the shipped default — an approval batch must not be interrupted by a second
    // confirmation the operator never asked for (31 号 §U-6 的风险行). `.volatile()` gives the field
    // its user layer, exactly like `pendingTtlMs` above.
    approvalConfirm: z.union([z.const('auto'), z.const('ask'), z.const('timeout')]).default('auto').volatile(),
  })

  private readonly enabledConfig?: Volatile<boolean> | undefined
  private readonly stageForegroundConfig: boolean
  /** The TTL carrier as configured: a plain number, or the live reference `.volatile()` hands a
   * user-layer field. Read through {@link ttl} at every use, never cached (registry row: live). */
  private readonly pendingTtlMsConfig?: Volatile<number> | undefined
  /** Keys this instance already warned about (clampOnce's once-per-key sink). */
  private readonly clampedKeys = new Set<string>()
  /** P3 (v16): public read for staging pre-checks (learning-graph refuses a
   * stage that no runner could replay only when foreground writes stage at
   * all). Mirrors `this.stageForeground`. */
  get stageForeground(): boolean {
    return this.stageForegroundConfig
  }
  private readonly runners = new Map<PendingKind, WriteRunner>()
  private readonly previews = new Map<PendingKind, WritePreview>()
  private readonly inFlight = new Map<string, Promise<{ ok: boolean; message: string }>>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionApproval')
    this.enabledConfig = config.enabled
    this.stageForegroundConfig = config.stageForeground ?? true
    this.pendingTtlMsConfig = config.pendingTtlMs
    // The reading face for the pending window (the settings panel's card). `ctx.inject` and not
    // `ctx.get`: profile rows apply in file order, so the web server may not exist yet — waiting on the
    // service mounts the routes whenever it arrives, and a profile without one stays inert.
    // G1 (0.21.0): this row now carries a user-writable field, so suppress the platform's own
    // auto-generated page for it — the family renders the card from the registry instead, and two
    // pages editing one row makes a write on the wrong one look ignored. Probed, not assumed: a
    // host without the capability still loads.
    this.ctx.inject(['settings'], (injected) => {
      const settings = (injected as { settings?: { configure?: (presentation: { auto?: boolean }, owner?: Fiber) => unknown } }).settings
      if (typeof settings?.configure !== 'function') return
      // The owner argument is what the platform looks the presentation up by; omitting it registers
      // the suppression on the settings service's own fiber and the auto form returns after a
      // re-mount (v46 S1.12b; platform precedent: settings.configure({ auto: false }, plugin.fiber)).
      const disposer = settings.configure({ auto: false }, this.ctx.fiber)
      if (typeof disposer === 'function') this.ctx.effect(() => disposer as () => void, 'evolution-approval: settings presentation')
    })
    // W6/G4: the platform's Host connection data plane is the ONLY admission path (trust, browser
    // auth, owner-only). registerHostRoutes waits on `connection` via inject and owns the route
    // effect; the audit snapshot is taken where the connection service is known.
    registerHostRoutes(this.ctx, audit => makeApprovalRoutes(this, audit))
  }

  private state(): EvolutionState {
    return this.ctx.evolutionState
  }

  /** Fail-closed capability adapters need to distinguish "allowed" from "enabled". */
  /** Host write capability exposed to settings/Facts; mirrors the live enabled switch. */
  get platformWrite(): boolean {
    return this.isEnabled
  }

  get isEnabled(): boolean {
    return unwrapLive(this.enabledConfig) ?? false
  }

  registerRunner(kind: PendingKind, runner: WriteRunner, preview?: WritePreview): () => void {
    // P3 (v3 audit): a duplicate kind would silently shadow the first runner
    // (mirroring EvolutionStateStorageRegistry.registerProvider, which throws).
    if (this.runners.has(kind)) throw new Error(`approval runner for "${kind}" is already registered`)
    this.runners.set(kind, runner)
    if (preview !== undefined) this.previews.set(kind, preview)
    return () => {
      if (this.runners.get(kind) === runner) this.runners.delete(kind)
      if (preview !== undefined && this.previews.get(kind) === preview) this.previews.delete(kind)
    }
  }

  /** The preview registered for `kind`, if that kind can show what its replay would write. */
  previewOf(kind: PendingKind): WritePreview | undefined {
    return this.previews.get(kind)
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
      return { ok: false, message: 'approval.run 是后台复核的回放通道；直接执行必须走工具路径（对前台而言，暂存是唯一的门禁旁路）。' }
    }
    const runner = this.runners.get(kind)
    if (!runner) return { ok: false, message: `没有为类型「${kind}」注册回放运行器。` }
    return await runner(args)
  }

  /** Evaluate one mutation. Returns allow, or stores the write and returns staged. */
  async request(input: ApprovalRequest): Promise<ApprovalDecision> {
    const summary = normalizeSummary(input)
    if (!this.isEnabled) return { action: 'allow', message: '批准已禁用。' }
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
      return { action: 'allow', message: '会话批准策略是「never」：写入无需暂存，直接放行。' }
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
        message: `写入已暂存待批准。用 /evolution pending 查看，并批准 ${record.id}。`,
      }
    }
    return { action: 'allow', message: '前台写入已放行。' }
  }

  /** T4-09/A51: the effective expiry of the staged window, 0 = never. Read by the command surface
   * and the doctor so both can say which of the three human-confirmation states is in force. */
  get ttlMs(): number {
    return this.ttl()
  }

  /**
   * The effective TTL in ms (0 = never expire), read at USE time.
   *
   * `clampOnce` is the family's ONE clamp-and-warn helper for a numeric knob that may be a live
   * settings reference (S2.9/T3-10): a plain number, a `{ get() }` reference, or nothing all land
   * on the same floor, and an invalid value warns once per instance instead of silently disabling
   * the window. The old inline `Number.isFinite` read stopped working the moment the field became
   * `.volatile()` — a reference is not a finite number, so the TTL silently read as 0.
   * @returns the TTL the sweep may use.
   */
  private ttl(): number {
    return Math.floor(clampOnce(this.clampedKeys, (message) => { this.ctx.logger.warn(message) }, 'pendingTtlMs', this.pendingTtlMsConfig, 0, 0))
  }

  /**
   * Close every staged write that has been waiting longer than the TTL (T4-09/A51).
   *
   * The window had THREE terminal states only — approve, reject, release — all of them human, so an
   * unattended deployment accumulated staged records for ever. Expiry is the missing third state of
   * the human-confirmation triangle ("never pop up and just run" / "wait indefinitely" / "cancel on
   * timeout"), and it is deliberately implemented as the reject side: the record converges through
   * the seam's exactly-once transition to `rejected` with its `resolvedAt` stamped, and the runner
   * is never invoked. NOTHING a human did not approve can execute; the cost of a wrong TTL is a
   * staged write that must be staged again.
   *
   * A sweep, not a timer: every read of the window converges it (the CLI, the settings card and the
   * doctor all read through {@link list}), so the family does not gain a background timer that would
   * have to be unref'd, disposed and reasoned about for process liveness.
   * @returns the ids that were closed by this sweep (empty when the TTL is off or nothing was stale).
   */
  async expireStale(): Promise<string[]> {
    // Read ONCE per sweep: the value is live (a settings write may land between two sweeps), and a
    // single read keeps the cut-off and the warning line describing the same number.
    const ttl = this.ttl()
    if (ttl <= 0) return []
    const cutoff = Date.now() - ttl
    const expired: string[] = []
    for (const record of await this.state().listPending('pending')) {
      const stagedAt = Date.parse(record.createdAt)
      // An unparseable timestamp is NOT stale evidence: the record stays for the operator (the same
      // posture the ordering helper takes — a missing timestamp must not decide anything).
      if (!Number.isFinite(stagedAt) || stagedAt > cutoff) continue
      const resolution = await this.state().tryResolvePending(record.id, 'rejected')
      if (resolution.applied) expired.push(record.id)
    }
    if (expired.length > 0) {
      this.ctx.logger.warn(`evolution-approval: ${expired.length} staged write(s) passed pendingTtlMs=${ttl} and were closed as rejected WITHOUT executing: ${expired.join(', ')} — stage them again if they are still wanted`)
    }
    return expired
  }

  async list(status: PendingStatus = 'pending'): Promise<PendingRecord[]> {
    // The convergence runs before EVERY read of a window, so no reader can see a record the TTL has
    // already passed (the CLI, the card and the doctor all go through here).
    await this.expireStale()
    return await this.state().listPending(status)
  }

  async approve(id: string, audit: DecisionAudit): Promise<{ ok: boolean; message: string }> {
    return await this.dedupe(`approve:${id}`, () => this.doApprove(id, audit))
  }

  /** S2-P2-22 (0.3.80): return an ORPHANED executing record to the pending
   * window. "Orphaned" is DECIDED here, never assumed: the older rationale
   * ("the family single-instance claim rules out any other live process") was
   * wrong (v43 FLOW2-1) — that claim is a module-scope Map in
   * core/instance-scope.ts, i.e. PER PROCESS, so a second process over one home
   * is not excluded at all. Two checks stand in its place:
   * 1. `inFlight` — an approve/reject running in THIS service instance;
   * 2. the claim's holder pid. Claim ids are minted as `<pid>:<hex token>` (this
   *    service's own grammar, see `claimHolderPid`), so that id plus a liveness
   *    probe answer whether the holder can still be running: a
   *    LIVE FOREIGN pid REFUSES the release; our own pid is this process's
   *    leftover (a live in-process approve is what `inFlight` covers); a dead pid
   *    is a crash. The last two are releasable, which is the S2-P2-22 case.
   * A claim carrying no pid (the bare-UUID claims minted before this change)
   * cannot be probed: the release then degrades to an explicitly DESTRUCTIVE
   * operator action and says so — re-approving replays the write, and that
   * replay is NOT idempotent if the effect already landed. The operator is
   * expected to verify the effect first; rejecting closes the record instead
   * (the stored `claimedBy` rides along as the seam's release credential, so no
   * state-seam expansion is needed). */
  async release(id: string): Promise<{ ok: boolean; message: string }> {
    const executing = (await this.state().listPending('executing')).find(item => item.id === id)
    if (!executing) {
      const pending = (await this.state().listPending('pending')).find(item => item.id === id)
      if (pending) return { ok: false, message: `待批准写入「${id}」已经在待批准窗口里：直接批准或拒绝它。` }
      return { ok: false, message: `待批准写入「${id}」不在执行窗口中：没有可释放的。` }
    }
    // The dedupe map keys in-flight work as `approve:${id}` / `reject:${id}`;
    // either running means the record is NOT an orphan in THIS process. It says
    // nothing about another process (v43 FLOW2-1) — the pid check below does.
    if (this.inFlight.has(`approve:${id}`) || this.inFlight.has(`reject:${id}`)) {
      return { ok: false, message: `待批准写入「${id}」在本进程里有正在运行的批准或拒绝：不要释放它。改为核验效果；已完成的批准会自行了结该记录。` }
    }
    const claimId = typeof (executing as { claimedBy?: unknown }).claimedBy === 'string' ? (executing as { claimedBy: string }).claimedBy : ''
    if (claimId === '') {
      return { ok: false, message: `待批准写入「${id}」没有可释放的占用声明（记录形状异常）：请改为拒绝它。` }
    }
    // v43 FLOW2-1: a claim naming a LIVE pid that is not ours means another
    // process may be mid-approve right now — never roll that record back under
    // a run that is still going.
    const holderPid = claimHolderPid(claimId)
    // R2 (round-2 audit): `0` is not a pid — `isProcessAlive(0)` probes the
    // caller's own process group on POSIX and would report a corrupt `0:<hex>`
    // claim as a live foreign holder forever. Treat pid 0 as no holder.
    if (holderPid !== null && holderPid > 0 && holderPid !== process.pid && isProcessAlive(holderPid)) {
      return { ok: false, message: `待批准写入「${id}」被 pid ${holderPid} 占用且该进程仍存活：可能有另一个进程正在执行这次批准。不要释放它：改为核验写入效果，并让那次运行跑完（已完成的批准会自行了结该记录）。` }
    }
    let released = false
    let failure = ''
    try {
      await this.state().releasePendingClaim(id, claimId)
      // v43 FLOW2-1: a provider-side no-op (the claim no longer matches the
      // record) must not read as success — the row would stay executing +
      // claimed with no trace anywhere. Confirm against the pending window.
      released = (await this.state().listPending('pending')).some(item => item.id === id)
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(error)
    }
    if (!released) {
      const cause = failure === '' ? 'the claim no longer matches the record — a concurrent writer moved it' : failure
      return { ok: false, message: `释放「${id}」没有生效（${cause}）：除非它已了结，否则仍处于 EXECUTING 且保留占用声明，写入效果也仍未核验。请重试，或拒绝它以在不重放的情况下关闭记录。` }
    }
    // The unverifiable branch is the honest degradation: the message is the
    // operator's confirmation surface, and it must name the replay risk.
    const unverifiable = holderPid === null
      ? ' Its claim carries no pid, so liveness could NOT be verified: another process may still be running this approve.'
      : ''
    return {
      ok: true,
      message: `已把「${id}」放回待批准窗口。${unverifiable} 批准前请先核验效果：批准会重跑该写入，非幂等的重放会造成效果重复；改为拒绝则可关闭该记录。`,
    }
  }

  async reject(id: string, audit: DecisionAudit): Promise<{ ok: boolean; message: string }> {
    return await this.dedupe(`reject:${id}`, async () => {
      // Reject claims the record like approve does, so a pending write resolves
      // on a single gate (F-204). The executing-rescue branch below does NOT
      // hold a claim: an 'executing' record may be an approve runner still in
      // flight, and resolving it to 'rejected' without a claim can race that
      // runner (the write may land after reject; the audit then reads
      // rejected). This is a documented best-effort operator cleanup, not a
      // second resolution gate.
      const claimId = this.newClaimId()
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
            ? { ok: true, message: `已拒绝执行中的写入「${id}」（未持有占用声明：这可能与在途的批准运行器抢跑；如果写入已落地，其效果按现状保留。请手动核验写入状态）。` }
            : { ok: false, message: `待批准写入「${id}」无法拒绝：它并发地了结了。` }
        }
        // 0.3.28 (V4-18): the record was NOT found AND is not 'executing', so it
        // is no longer in the active window — either it was already resolved
        // (approved/rejected) and later rotated past PENDING_RESOLVED_CAP, or it
        // never existed. The old "already being resolved by another writer"
        // message mis-attributed a rotated/archived id to a live concurrent
        // writer (the cap rotation magnified it into a misleading claim).
        return { ok: false, message: `待批准写入「${id}」不在待批准窗口里（已轮转或已了结）。` }
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
        return { ok: false, message: `待批准写入「${id}」已不在待批准状态（已了结或不存在）。` }
      }
      await this.recordDecision(resolution.record, audit)
      return { ok: true, message: `已拒绝 ${resolution.record.kind} 写入「${id}」。` }
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

  /** v43 FLOW2-1: a claim id that CARRIES its holder pid — `claimHolderPid` reads
   * it back and the liveness probe turns it into `release()`'s verifiable orphan
   * criterion. The token stays unique per call, so two approves of one record can
   * never share a claim (a dashed UUID stripped to hex, which is what the
   * claim-id grammar accepts). */
  private newClaimId(): string {
    return `${process.pid}:${randomUUID().split('-').join('')}`
  }

  private dedupe(id: string, task: () => Promise<{ ok: boolean; message: string }>): Promise<{ ok: boolean; message: string }> {
    const existing = this.inFlight.get(id)
    if (existing) return existing
    const run = task().finally(() => { this.inFlight.delete(id) })
    this.inFlight.set(id, run)
    return run
  }

  /** W6: attach the platform's admission decision to a resolved record (read-tolerant; absent on
   * records resolved by expiry or before 0.2.1). */
  private async recordDecision(record: PendingRecord | null, audit: DecisionAudit): Promise<void> {
    if (record === null) return
    try {
      await this.state().savePending({ ...record, decidedBy: audit })
    } catch (error) {
      // The decision itself already landed; an audit-attachment failure must not turn a successful
      // approve/reject into a refusal. It is logged, never silent.
      this.ctx.logger.warn('evolution-approval: could not attach decidedBy audit: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  private async doApprove(id: string, audit: DecisionAudit): Promise<{ ok: boolean; message: string }> {
    const claimId = this.newClaimId()
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
        return { ok: false, message: `待批准写入「${id}」正在执行：可能有另一个写入方正在了结它，或此前一次批准跑过之后崩了。如果不是你发起的这次批准，就不要拒绝它（在途的运行会自行完成）；改为核验效果。确实卡住的记录（运行器没有任何动静）仍然可以拒绝 —— /evolution pending 会把它显示为 EXECUTING。` }
      }
      // 0.3.28 (V4-18): as in reject, a non-executing miss is a rotated/archived
      // id, not a live concurrent writer — keep the attribution honest.
      return { ok: false, message: `待批准写入「${id}」不在待批准窗口里（已轮转或已了结）。` }
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
          if (rejected) return { ok: false, message: `能力「${id}」已获批准，但记录被并发地了结为「rejected」：没有代码运行，也无需重放；重新提交前请先核验。` }
          return { ok: false, message: `待批准写入「${id}」已被另一个写入方了结。` }
        }
        await this.recordDecision(resolution.record, audit)
        return { ok: true, message: '能力已批准，可在 Creator 模式下手动激活（未执行任何代码）。' }
      }
      await this.state().releasePendingClaim(id, claimId)
      return { ok: false, message: `没有为类型「${record.kind}」注册回放运行器。` }
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
        // F-7 (2026-10-12): the vocabulary is bilingual (English stubs in the specs, Chinese
        // producers in the tree) and also covers the skill-store's anchor-drift refusal.
        // deterministic "Path traversal is not allowed." refusal — a staged
        // record with a traversal target fails every approve the same way.
        // Long-term option: the store layer could surface structured errors
        // with a machine-readable code (deferred this cycle; see the plan's
        // non-goals list).
        // F-7 (2026-10-12): the vocabulary is language-agnostic now — the user-visible refusals
        // are Chinese, so the Chinese phrasings of the same five cases are matched too. The
        // structured-code option above remains the long-term fix.
        const deterministic = new RegExp(
          'changed since this plan|no entry matching|not found|no longer exists|path traversal|' +
            '在图渲染之后被改动过|匹配到多条不同条目|已不存在|不存在|路径穿越|不在技能|找不到|被改动过|已改动|不匹配|已过期|changed since it was read',
          'i',
        ).test(result.message)
        return {
          ok: false,
          message: deterministic
            ? `${result.message} 同一计划里的兄弟写入可能已改动该目标，反复批准会一直失败；除非目标再次变更，请驳回该记录。`
            : result.message,
        }
      }
    } catch (error) {
      await this.state().releasePendingClaim(id, claimId)
      this.ctx.logger.warn(error)
      return { ok: false, message: '回放运行器失败：该待批准写入仍处于待批准状态。' }
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
        message: `已批准写入「${id}」已重放，但了结记录失败（${resolution.slice('failed: '.length)}）：效果已经落地，而审计行仍停在「executing」。请手动核验该写入；批准不会再次重跑它。`,
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
          message: `已批准写入「${id}」已重放，但记录被并发地了结为「rejected」：效果已落地，而审计显示为 rejected。请核验该写入，且不要重放它。`,
        }
      }
      return { ok: false, message: `待批准写入「${id}」已被另一个写入方了结。` }
    }
    // 0.3.17 (E-61): the success message names what was approved, not just
    // the kind — a reviewer acting on several batches can tell them apart.
    await this.recordDecision(resolution.record, audit)
    return { ok: true, message: `已批准 ${record.kind} 写入「${id}」（${record.summary}）。` }
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
