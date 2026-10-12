/**
 * Host half: ONE read-only route, mounted when the profile gives this row a web server.
 *
 * **Why `ctx.inject` and not `ctx.get`**: profile rows apply in file order, so at this row's apply
 * time the web server may not exist yet — a `ctx.get('webServer')` of undefined is a TIMING fact,
 * not a verdict, and acting on it leaves the route unregistered while the panel renders and every
 * call answers 404. Waiting on the service mounts the route whenever it arrives, and a profile that
 * never gets one simply never runs this callback — inert, never pending.
 * @module @deepseek-ai/dsh-evolution-skill-health
 */

import type { Context } from '@deepseek-ai/cordis'
// Activates the Context merges this row reads. Type-only: the platform packages stay dev-time edges.
import type {} from '@deepseek-ai/dsh-evolution-curator'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makeSkillHealthRoutes } from './routes.ts'

/** No required services: the web server is WAITED ON below, not demanded here. */
export const inject: string[] = []

/**
 * Mount the route as ONE effect (disposers run on unload and on HMR).
 * @param ctx - the host context; the web server and curator arrive through it.
 */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const routes = makeSkillHealthRoutes({ getCurator: () => scope.get('evolutionCurator') })
      const disposers = routes.map(route => scope.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'evolution-skill-health: routes')
  })
}
