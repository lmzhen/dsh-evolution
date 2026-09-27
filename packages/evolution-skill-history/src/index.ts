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

/** No declared service: the web server is OPTIONAL (a headless profile has none) and the curator is
 * resolved per request, so the row activates wherever it is installed and answers honestly where a
 * service is missing — the platform rule for optional services is ctx.get, not a waited-on inject. */
export const inject: string[] = []

/**
 * Mount the routes as ONE effect: the disposers run on unload and on HMR.
 * @param ctx - the host context carrying webServer and the curator.
 */
export function apply(ctx: Context): void {
  const webServer = ctx.get('webServer')
  // A profile with no web server (headless, or a row installed without the web app) has nothing to
  // mount: the slash commands stay the entry point there, so this row is inert rather than pending.
  if (webServer === undefined) return
  ctx.effect(() => {
    const routes = makeSkillHistoryRoutes({ getCurator: () => ctx.get('evolutionCurator') })
    const disposers = routes.map(route => webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'evolution-skill-history: routes')
}
