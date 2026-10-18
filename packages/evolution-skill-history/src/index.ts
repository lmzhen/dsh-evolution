/**
 * Host half of the skill-history surface: it mounts the six routes the sidebar panel reads and
 * writes, and it owns nothing else.
 *
 * W6/G4: the carrier is the platform's Host connection data plane. `registerHostRoutes` waits on the
 * `connection` service (it may apply after this row), registers via one owner effect and captures the
 * DecisionAudit there; the old webServer + loopback fence path is gone.
 *
 * The version FACTS come from evolution-core (which artifact a version holds, how the body chain and
 * the support-file chain split) and the only write is the curator's undo, so this row carries no state
 * of its own: unloading it removes the routes and leaves the feature's data untouched.
 * @module @deepseek-ai/dsh-evolution-skill-history
 */
import type { Context } from '@deepseek-ai/cordis'
// Activates the Context merges this row reads. Type-only: the platform packages stay dev-time edges.
import type {} from '@deepseek-ai/dsh-evolution-curator'
import { registerHostRoutes } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { makeSkillHistoryRoutes } from './routes.ts'

export const name = 'evolution-skill-history'

/** No declared service: a headless profile must not leave a pending row, and the curator is resolved
 * per request; `connection` is waited on inside registerHostRoutes, not demanded here. */
export const inject: string[] = []

/**
 * Mount the routes as ONE owner effect (disposers run on unload and on HMR). A profile whose host has
 * no connection service simply never runs the callback — inert, never pending.
 * @param ctx - the host context; the connection and curator arrive through it.
 */
export function apply(ctx: Context): void {
  registerHostRoutes(ctx, (audit) => makeSkillHistoryRoutes({ getCurator: () => ctx.get('evolutionCurator') }, audit))
}
