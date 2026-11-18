/**
 * Host half of the skill-history surface: it mounts the seven routes the sidebar panel reads and
 * writes, and it owns nothing else.
 *
 * W6/G4: the carrier is the platform's Host connection data plane. `registerHostRoutes` waits on the
 * `connection` service (it may apply after this row), registers via one owner effect and captures the
 * DecisionAudit there; the old webServer + loopback fence path is gone.
 *
 * The version FACTS come from evolution-core (which artifact a version holds, how the body chain and
 * the support-file chain split) and the only write is the curator's undo, so this row carries no state
 * of its own: unloading it removes the routes and leaves the feature's data untouched.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history
 */
import type { Context } from '@deepseek-ai/cordis'
// Activates the Context merges this row reads. Type-only: the platform packages stay dev-time edges.
import type {} from '@deepseek-ai/dsh-evolution-curator'
import { newRunRegistry, evolutionHome, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
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
  // platform-declaration anchor: the optional `skillUsage` seat is declared by
  // evolution-core/src/usage.ts, and `evolutionFeedback` by
  // evolution-activity/src/feedback/index.ts. Both are probes for an optional
  // aggregate read; absence keeps the route's usage/feedback fields null.
  registerHostRoutes(ctx, audit => makeSkillHistoryRoutes({
    getCurator: () => ctx.get('evolutionCurator'),
    getHealthView: async () => {
      const curator = ctx.get('evolutionCurator') as { healthView?: () => Promise<unknown> } | undefined
      return curator?.healthView?.()
    },
    getUsage: async () => {
      const usage = ctx.get('skillUsage') as { report?: () => Promise<unknown> } | undefined
      return usage?.report?.()
    },
    getFeedback: (names) => {
      const feedback = ctx.get('evolutionFeedback') as { score?: (name: string, kind?: 'skill' | 'session') => number } | undefined
      if (typeof feedback?.score !== 'function') return undefined
      const scores: Record<string, number> = {}
      for (const name of names) scores[name] = feedback.score(name, 'skill')
      return scores
    },
    getFeedbackWindow: async (days) => {
      const feedback = ctx.get('evolutionFeedback') as { recent?: (days: number) => Promise<unknown> } | undefined
      if (typeof feedback?.recent !== 'function') return null
      return await feedback.recent(days)
    },
    getGovernance: async () => {
      const ioRegistry = ctx.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
      if (ioRegistry === undefined) return null
      const io = ioRegistry.provider()
      const registry = newRunRegistry({ io, home: evolutionHome() })
      const loaded = await registry.load()
      if (!loaded.ok) return null
      const recent = registry.runs('governance').slice(0, 5)
      const rows: Array<{ runId: string; state: string; startedAt: number; target: string | null; mode: string | null; resultRef: string | null }> = []
      for (const run of recent) {
        let target: string | null = null
        let mode: string | null = null
        if (run.resultRef !== undefined) {
          try {
            const raw = await io.readText(run.resultRef)
            const parsed = raw === null ? undefined : JSON.parse(raw) as { target?: unknown; mode?: unknown }
            if (typeof parsed?.target === 'string') target = parsed.target
            if (typeof parsed?.mode === 'string') mode = parsed.mode
          } catch { /* a missing/corrupt report does not hide the run row */ }
        }
        rows.push({
          runId: run.id,
          state: run.state,
          startedAt: run.startedAt,
          target,
          mode,
          resultRef: run.resultRef ?? null,
        })
      }
      return rows
    },
    getCounts: async () => {
      const curator = ctx.get('evolutionCurator') as {
        skills?: { list?: () => Promise<ReadonlyArray<{ name: string }>> }
        history?: (name: string) => Promise<ReadonlyArray<{ action?: unknown; unitId?: unknown }>>
      } | undefined
      if (curator?.skills?.list === undefined || curator.history === undefined) return null
      const ioRegistry = ctx.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
      if (ioRegistry === undefined) return null
      const io = ioRegistry.provider()
      const registry = newRunRegistry({ io, home: evolutionHome() })
      const loaded = await registry.load()
      if (!loaded.ok) return null
      const counts = { offload: 0, condense: 0, extract: 0 }
      for (const run of registry.runs('governance')) {
        if (run.state !== 'succeeded' || run.resultRef === undefined) continue
        try {
          const raw = await io.readText(run.resultRef)
          const report = raw === null ? undefined : JSON.parse(raw) as { mode?: unknown }
          if (report?.mode === 'condense') counts.condense += 1
        } catch { /* a missing report is not a successful count */ }
      }
      // offload is restructure now; extract is one cross-skill unit.
      const restructureUnits = new Set<string>()
      const extractUnits = new Set<string>()
      try {
        for (const skill of await curator.skills.list()) {
          const history = await curator.history(skill.name)
          for (const entry of history) {
            if (typeof entry.unitId !== 'string' || entry.unitId === '') continue
            if (entry.action === 'restructure') restructureUnits.add(entry.unitId)
            else if (entry.action === 'extract') extractUnits.add(entry.unitId)
          }
        }
      } catch { return null }
      counts.offload = restructureUnits.size
      counts.extract = extractUnits.size
      return counts
    },
  }, audit))
}

