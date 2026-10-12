import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
/**
 * The panel's ONE read-only route: the health rows the browser half renders.
 *
 * Read-only by construction: it never writes a skill, a marker or a config. It also carries the
 * house rule down to the client — a rule whose threshold is NOT calibrated yet is reported with
 * `countIsMeaningful: false`, so the panel can name it without printing a number we do not have.
 * @module @deepseek-ai/dsh-evolution-skill-health
 */

/** Where the panel asks for its rows. */
export const ROUTES = {
  rows: '/api/dsh-evolution/skill-health/rows',
} as const

/** Rules whose threshold is not calibrated yet: named on screen, never counted. */
export const UNCALIBRATED_RULES: readonly string[] = ['references-sprawl']

/** One finding as the client sees it. `line` is null when the position cannot be named. */
export interface RouteFinding { rule: string; count: number; line: string | null; countIsMeaningful: boolean }

/** One row as the client sees it. `readable: false` becomes its own verdict, never `ok`. */
export interface RouteRow { name: string; verdict: string; findings: RouteFinding[] }

/**
 * Project the curator's health view into what the panel renders.
 * @param rows - `{ name, verdict, dims, findings }` per skill, as `healthView()` returns them.
 * @returns the same rows, with unreadable skills kept apart and uncalibrated rules uncounted.
 */
export function toRouteRows(rows: ReadonlyArray<{
  name: string
  verdict: string
  findings: ReadonlyArray<{ rule: string; count: number; line?: string | null }>
  dims?: { readable?: boolean } | null
}>): RouteRow[] {
  return rows.map(row => ({
    name: row.name,
    verdict: row.dims?.readable === false ? 'unreadable' : row.verdict,
    findings: row.findings.map(finding => ({
      rule: finding.rule,
      count: finding.count,
      line: finding.line ?? null,
      countIsMeaningful: !UNCALIBRATED_RULES.includes(finding.rule),
    })),
  }))
}

/**
 * Build the panel's routes, in the platform shape: `{ path, handler(req, res) }` — the same objects
 * `ctx.webServer.register` takes for every other row in this family.
 * @param deps - a getter for the curator service (absent until the profile mounts it).
 * @returns one GET route; with no curator it answers an EMPTY row list plus `truncated: true`, which
 *   the panel shows as "cannot decide right now" rather than as a pass.
 */
export function makeSkillHealthRoutes(deps: { getCurator: () => { healthView?: () => Promise<unknown> } | undefined }): WebRoute[] {
  return [{
    kind: 'exact',
    path: ROUTES.rows,
    handler: async (_req, res) => {
      const curator = deps.getCurator()
      const view = curator?.healthView === undefined ? undefined : await curator.healthView()
      const rows = Array.isArray(view) ? toRouteRows(view as Parameters<typeof toRouteRows>[0]) : []
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ rows, truncated: view === undefined }))
    },
  }]
}
