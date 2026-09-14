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
 * variant preset only the sessions that selected one do. The shipped bundles set
 * it; a bare library mount and the host-only infrastructure mode leave it false
 * and keep the historical "every session" behavior.
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
 * The one decision every cross-session consumer calls before it acts.
 * @param ctx - a context of the runtime.
 * @param sessionId - the session the event belongs to.
 * @param sessionScoped - the row's `sessionScoped` config.
 * @returns true when the consumer may act on this session. A deployment that did
 * not declare session scoping always answers true (the historical behavior);
 * a scoped one answers true only for a session that carries the family's model
 * tools.
 */
export function sessionAudited(ctx: Context, sessionId: string, sessionScoped: boolean | undefined): boolean {
  if (sessionScoped !== true) return true
  return sessionSeesFamilyTools(ctx, sessionId)
}
