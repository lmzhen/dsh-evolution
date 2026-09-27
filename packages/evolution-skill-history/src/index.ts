/**
 * Host half of the skill-history surface: it mounts the four loopback routes the sidebar panel reads
 * and writes, and it owns nothing else.
 *
 * The version FACTS come from evolution-core (which artifact a version holds, how the body chain and
 * the support-file chain split) and the only write is the curator's undo, so this row carries no state
 * of its own: unloading it removes the routes and leaves the feature's data untouched.
 * @module @deepseek-ai/dsh-evolution-skill-history
 */

import type { Context } from '@deepseek-ai/cordis'
// Activates the Context merges this row reads. Type-only: the platform packages stay dev-time edges.
import type {} from '@deepseek-ai/dsh-evolution-curator'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makeSkillHistoryRoutes } from './routes.ts'

export const name = 'evolution-skill-history'

/** No declared service: a headless profile must not leave a pending row, and the curator is resolved
 * per request. The web server is waited on INSIDE apply (see below), not declared here. */
export const inject: string[] = []

/**
 * Wait for the web server, then mount the routes as ONE effect (disposers run on unload and on HMR).
 *
 * **Why `ctx.inject` and not `ctx.get`**: profile rows apply in file order, so at this row's apply time
 * the web server may not exist yet — `ctx.get('webServer')` returning undefined is a TIMING fact, not a
 * verdict, and acting on it (0.11.1 shipped that way) left the routes permanently unregistered while the
 * panel rendered and every call answered HTTP 404. Waiting on the service mounts the routes whenever it
 * arrives, and a profile that never gets one simply never runs this callback — inert, never pending.
 * @param ctx - the host context; the web server and curator arrive through it.
 */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const routes = makeSkillHistoryRoutes({ getCurator: () => scope.get('evolutionCurator') })
      const disposers = routes.map(route => scope.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'evolution-skill-history: routes')
  })
}
