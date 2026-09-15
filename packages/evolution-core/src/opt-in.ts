/**
 * Variant-form opt-in: WHICH sessions the family's cross-session consumers act on.
 *
 * The family ships in two install forms. Mounted onto the original presets (the
 * profile-level bundle), EVERY session is a family session and the consumers
 * below keep acting on all of them. In the VARIANT form the family's model tools
 * exist only inside a variant preset, so a session that did not select one never
 * opted in — yet the cross-session consumers (review cadence and injection,
 * skill-usage telemetry) live at profile root and used to act on every session
 * anyway, including the platform's original presets: a user who installed a
 * variant was still injected with review prompts and still counted in usage.
 *
 * The two forms are told apart WITHOUT a list of preset ids and WITHOUT a second
 * source of truth: a session is a family session exactly when the family's own
 * model tools are visible in its scope. Mounted at profile root they are visible
 * to every session; mounted inside a variant preset they are visible only to the
 * agents that joined that preset's standing scope — every registration inside a
 * preset files into that agent's layer
 * (packages/preset/agent-presets/src/mount.ts:4-13).
 *
 * `sessionScoped` is what a deployment declares: true means "act only on a
 * session that carries the family's model tools", which is the right question in
 * BOTH install forms — at profile root every session carries them, inside a
 * variant preset only the sessions that selected one do. The shipped bundles all
 * set it, evolution-host included (S0-4 / v43 G-1); a bare library mount leaves
 * it false and keeps the historical "every session" behavior. The host-only
 * install thus matches nothing unless the model tool packages are mounted some
 * other way, because that bundle mounts no model tool row.
 *
 * S0-4 (v43 J-1 / G-1): the gate's false used to be SILENT, which left exactly
 * those deployments — host-only, or an overlay that disables tool-memory /
 * tool-skill-manage — indistinguishable from an ordinary per-session skip while
 * review injection and skill-usage telemetry stayed off for every session. The
 * witness below records what the gate saw, the first scoped miss with no match
 * ever leaves ONE warn per process, and `scopedProbeReport()` is the read side
 * `/evolution doctor` renders as `scoped rows × probe`.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { OpaqueScopeKey } from './scope.ts'

/**
 * Tool names only a session that mounted the family's MODEL rows can see.
 *
 * Both are family packages (`tool-skill-manage`, `tool-memory`), so a session
 * that merely carries the platform's own session-query tool is not mistaken for
 * a family session. Two names, not one: a deployment may disable either row.
 */
export const FAMILY_SESSION_TOOL_NAMES: readonly string[] = ['skill_manage', 'memory']

/**
 * S0-4 (v43 J-1 / G-1): the process-wide witness behind the deployment
 * diagnostic. A scoped false is the CORRECT answer for a session that did not
 * opt in, so the miss alone proves nothing — "no session in this process ever
 * matched" is the shape both real faults share, and only a witness that outlives
 * one session can tell it from a healthy per-session skip.
 *
 * Module scope on purpose: the claim spans every session and every row of this
 * process, so no single row's fiber owns it. Monotone scalars with no per-key
 * lifecycle — the N12 registry covers module-scope Set/Map/WeakMap stores, which
 * carry entries that do need one.
 */
let scopedProbeHits = 0
let scopedProbeMisses = 0
let scopedProbeWarned = false

/** What the session-scoped gate has seen in this process. */
export interface ScopedProbeReport {
  /** `hit` — at least one session carried the family tools; `never-hit` — the
   * gate evaluated sessions and rejected every one; `idle` — it has not been
   * asked yet (no session event reached a scoped consumer since startup). */
  verdict: 'hit' | 'never-hit' | 'idle'
  /** Scoped evaluations that resolved true. */
  hits: number
  /** Scoped evaluations that resolved false. */
  misses: number
}

/**
 * Read the witness for a diagnostic surface (`/evolution doctor`). Read-only: it
 * neither evaluates the probe nor consumes the one-time warn, so a report run
 * cannot change what the next miss would have logged.
 * @returns the verdict with both counts, zeroed in a process where the gate has
 * not run.
 */
export function scopedProbeReport(): ScopedProbeReport {
  const verdict: ScopedProbeReport['verdict'] = scopedProbeHits > 0 ? 'hit' : scopedProbeMisses > 0 ? 'never-hit' : 'idle'
  return { verdict, hits: scopedProbeHits, misses: scopedProbeMisses }
}

/**
 * The two platform services this probe reads, kept structural: they are read
 * through `ctx.get` (the global store — the documented form for an optional
 * service, postmortem 0001), and a deployment may mount neither.
 */
interface SessionProbeContext {
  get(name: 'agents'): { get(id: string): { ctx?: Context } | undefined } | undefined
  get(name: 'tools'): { get(name: string, scope?: OpaqueScopeKey): unknown } | undefined
}

/**
 * Does this session's scope see the family's model tools?
 *
 * The scope is the live agent's — the platform's own addressing for "what does
 * this session see" (`tools.get(name, scope)`, packages/core/tools/src/index.ts:1194).
 * A session with no live agent (a finished or cold session) has no scope to ask
 * in, so it resolves to false; the consumers this gate serves only run for live
 * agents.
 * @param ctx - a context of the runtime (any plane; the services are read from the global store).
 * @param sessionId - the session to ask about.
 * @returns true when at least one family model tool is visible to that session.
 */
export function sessionSeesFamilyTools(ctx: Context, sessionId: string): boolean {
  const probe = ctx as unknown as SessionProbeContext
  const tools = probe.get('tools')
  if (tools === undefined) return false
  const agent = probe.get('agents')?.get(sessionId)
  const scope = agent?.ctx === undefined ? undefined : scopeOf(agent.ctx)
  return FAMILY_SESSION_TOOL_NAMES.some(name => tools.get(name, scope) !== undefined)
}

/**
 * S0-4 (v43 J-1 / G-1): record a scoped rejection and leave the one-time
 * deployment diagnostic.
 *
 * Fires at most once per process, on the first miss, and only while nothing has
 * ever matched. The message names the check rather than guessing the deployment
 * form: a host-only install and a disabled model row are the two shapes that can
 * never match, while the layered variant form legitimately waits for a session
 * that selected the Evolution preset.
 * @param ctx - the asking row's context; the warn rides that row's own logger.
 */
function noteScopedProbeMiss(ctx: Context): void {
  scopedProbeMisses += 1
  if (scopedProbeHits > 0 || scopedProbeWarned) return
  scopedProbeWarned = true
  ctx.logger.warn('dsh-evolution: sessionScoped is on but the family-tool probe has never matched a session in this process'
    + ' — review injection and skill-usage telemetry are inert for every session seen so far.'
    + ' Check whether the family\'s model rows are mounted at all: tool-memory / tool-skill-manage are devDependencies of'
    + ' @lmzhen/dsh-evolution-host, so a HOST-ONLY install can never match, and a profile overlay that disables either row'
    + ' has the same effect. Under the layered VARIANT form only a session on the Evolution preset matches, so a miss there'
    + ' just means none has run yet. Next: /evolution doctor reports the scoped rows and this verdict (see INSTALL.md).')
}

/**
 * The one decision every cross-session consumer calls before it acts.
 * @param ctx - a context of the runtime.
 * @param sessionId - the session the event belongs to.
 * @param sessionScoped - the row's `sessionScoped` config.
 * @returns true when the consumer may act on this session. A deployment that did
 * not declare session scoping always answers true (the historical behavior);
 * a scoped one answers true only for a session that carries the family's model
 * tools. Each scoped answer updates the process witness, and the first miss with
 * no match ever leaves one warn (see {@link noteScopedProbeMiss}).
 */
export function sessionAudited(ctx: Context, sessionId: string, sessionScoped: boolean | undefined): boolean {
  if (sessionScoped !== true) return true
  if (sessionSeesFamilyTools(ctx, sessionId)) {
    scopedProbeHits += 1
    return true
  }
  noteScopedProbeMiss(ctx)
  return false
}
