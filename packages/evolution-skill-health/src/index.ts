/**
 * Host half: ONE read-only route, mounted on the platform's Host connection data plane.
 *
 * W6/G4: `registerHostRoutes` waits on the `connection` service (it may apply after this row),
 * registers via one owner effect and captures the DecisionAudit there. The old webServer + loopback
 * fence path is gone: trust/auth/owner admission are the platform's.
 * @module @deepseek-ai/dsh-evolution-skill-health
 */
import type { Context } from '@deepseek-ai/cordis'
// Activates the Context merges this row reads. Type-only: the platform packages stay dev-time edges.
import type {} from '@deepseek-ai/dsh-evolution-curator'
import { registerHostRoutes } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { readProposalReports, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { makeSkillHealthRoutes } from './routes.ts'

/** No required services: `connection` is waited on inside registerHostRoutes, not demanded here. */
export const inject: string[] = []

/**
 * Mount the route as ONE owner effect (disposers run on unload and on HMR).
 * @param ctx - the host context; the connection and curator arrive through it.
 */
export function apply(ctx: Context): void {
  registerHostRoutes(ctx, audit => makeSkillHealthRoutes({
    getCurator: () => ctx.get('evolutionCurator'),
    getProposals: async () => {
      const registry = ctx.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
      const io = registry?.provider()
      return io === undefined ? undefined : readProposalReports(io)
    },
  }, audit))
}
