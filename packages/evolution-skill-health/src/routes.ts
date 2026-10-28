/**
 * The panel's ONE read-only route: the health rows the browser half renders.
 *
 * W6/G4: exact FetchRoute on the platform Host connection data plane — trust/auth/owner admission are
 * the platform's, so there is no fence here. Read-only by construction: it never writes a skill, a
 * marker or a config. It also carries the house rule down to the client — a rule whose threshold is
 * NOT calibrated yet is reported with `countIsMeaningful: false`, so the panel can name it without
 * printing a number we do not have.
 * @module @deepseek-ai/dsh-evolution-skill-health
 */
import { HOST_ROUTES, json, methodNotAllowed } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { ConnectionFetchRouteLike, DecisionAudit } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { ProposalView } from '@deepseek-ai/dsh-evolution-core'

/** Where the panel asks for its rows. The ONE declaration lives in core (W1). */
export const ROUTES = HOST_ROUTES.skillHealth

/** Rules whose threshold is not calibrated yet: named on screen, never counted. */
export const UNCALIBRATED_RULES: readonly string[] = ['references-sprawl']

/** One finding as the client sees it. `line` is null when the position cannot be named. */
export interface RouteFinding {
  rule: string
  count: number
  line: string | null
  countIsMeaningful: boolean
  severity?: 'warn' | 'error'
  message?: string
}

/** The measured dimensions behind a row, for evidence chips; absent when the scan could not read them. */
export interface RouteDims {
  bodyChars: number | null
  bodyTokens: number | null
  supportGroups: number
  supportFiles: number | null
  churnPatches: number | null
  churnReads: number | null
  stampDensityPerKb: number | null
}

/** One row as the client sees it. `readable: false` becomes its own verdict, never `ok`. */
export interface RouteRow {
  name: string
  verdict: string
  findings: RouteFinding[]
  dims?: RouteDims | null
}

/**
 * Project the curator's health view into what the panel renders.
 * @param rows - `{ name, verdict, dims, findings }` per skill, as `healthView()` returns them.
 * @returns the same rows, with unreadable skills kept apart and uncalibrated rules uncounted.
 */
export function toRouteRows(rows: ReadonlyArray<{
  name: string
  verdict: string
  findings: ReadonlyArray<{ rule: string; count: number; line?: string | null; severity?: 'warn' | 'error'; message?: string }>
  dims?: (Partial<RouteDims> & { readable?: boolean }) | null
}>): RouteRow[] {
  return rows.map(row => ({
    name: row.name,
    verdict: row.dims?.readable === false ? 'unreadable' : row.verdict,
    findings: row.findings.map(finding => ({
      rule: finding.rule,
      count: finding.count,
      line: finding.line ?? null,
      countIsMeaningful: !UNCALIBRATED_RULES.includes(finding.rule),
      ...(finding.severity === undefined ? {} : { severity: finding.severity }),
      ...(finding.message === undefined ? {} : { message: finding.message }),
    })),
    ...(row.dims === undefined || row.dims === null ? {} : { dims: {
      bodyChars: row.dims.bodyChars ?? null,
      bodyTokens: row.dims.bodyTokens ?? null,
      supportGroups: row.dims.supportGroups ?? 0,
      supportFiles: row.dims.supportFiles ?? null,
      churnPatches: row.dims.churnPatches ?? null,
      churnReads: row.dims.churnReads ?? null,
      stampDensityPerKb: row.dims.stampDensityPerKb ?? null,
    } }),
  }))
}

/**
 * Build the panel's route in the platform's exact FetchRoute shape.
 * @param deps - a getter for the curator service (absent until the profile mounts it).
 * @param _audit - the registration audit (read-only surface: nothing to record).
 * @returns one GET route; with no curator it answers an EMPTY row list plus `truncated: true`, which
 *   the panel shows as "cannot decide right now" rather than as a pass.
 */
export function makeSkillHealthRoutes(
  deps: {
    getCurator: () => { healthView?: () => Promise<unknown> } | undefined
    /** The one proposer's read seam; absent means the panel must say unavailable. */
    getProposals?: () => readonly ProposalView[] | undefined | Promise<readonly ProposalView[] | undefined>
  },
  _audit: DecisionAudit,
): ConnectionFetchRouteLike[] {
  return [{
    path: ROUTES.rows,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method !== 'GET') return methodNotAllowed(['GET'])
      const curator = deps.getCurator()
      const view = curator?.healthView === undefined ? undefined : await curator.healthView()
      const rows = Array.isArray(view) ? toRouteRows(view as Parameters<typeof toRouteRows>[0]) : []
      const proposals = await deps.getProposals?.() ?? []
      // W6 §3: every family route answers the SAME envelope (the shared client route-client
      // classifies 2xx as {ok,data}); the old bare {rows,truncated} body was a second wire shape.
      return json(200, {
        ok: true,
        data: {
          rows,
          truncated: view === undefined,
          readAt: Date.now(),
          scan: { status: view === undefined ? 'unavailable' : 'complete' },
          proposals,
          proposalStatus: deps.getProposals === undefined ? 'unavailable' : 'available',
        },
      })
    },
  }]
}
