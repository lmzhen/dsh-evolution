/**
 * G6/W8: the diagnostics Host route — the browser face of the SAME DiagnosticsView the CLI prints.
 *
 * Registration belongs to W6 (`registerHostRoutes` is called by the commands plugin's apply), so
 * this module only supplies the handler. A failed input assembly is NOT a transport error: the
 * handler answers an all-unknown view naming the failure, because doctor must never throw (W8 §6).
 *
 * W9-g5: the assembly is expensive (soft probes plus platform queries; measured 19-37 s on a real
 * profile) and several tabs may poll it. The handler therefore owns a read cache: ONE in-flight
 * assembly shared by every concurrent caller, a short TTL for reuse, and a budget after which the
 * request answers "not decided" instead of waiting forever. Without a cancel signal from the
 * platform a timed-out assembly still finishes; it then populates the cache for the next read.
 * @module @deepseek-ai/dsh-evolution-commands/diagnostics-route
 */
import { HOST_ROUTES, json, methodNotAllowed } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { ConnectionFetchRouteLike } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { buildDoctorView, unavailableDoctorView, type DoctorInputs } from './doctor-view.ts'

/** The view the route answers: whatever uildDoctorView produces (the CLI renders the same). */
type DoctorView = ReturnType<typeof buildDoctorView>

/** Read-lifecycle knobs; every one has a production default and none reads the environment. */
export interface DiagnosticsRouteOptions {
  /** Reuse one successful view for this long (default 5 s). */
  readonly ttlMs?: number
  /**
   * Answer "not decided" when one assembly runs longer than this (default 60 s). The bound exists to
   * stop an unbounded wait, not to promise latency: the measured assembly takes 19-37 s on a real
   * profile, so a 5 s budget would answer unknown forever. It can drop to 5 s once the second form
   * derivation is removed (audit F9, tracked under G3).
   */
  readonly timeoutMs?: number
  /** Clock seam for tests. */
  readonly now?: () => number
}

const DEFAULT_TTL_MS = 5_000
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Build the diagnostics route over one input producer.
 * @param getInputs - assembles the live view inputs (soft probes; may reject).
 * @param options - TTL, budget and clock (defaults: 5 s each, wall clock).
 * @returns the exact Fetch route for `HOST_ROUTES.diagnostics.view`.
 */
export function makeDiagnosticsRoutes(getInputs: () => Promise<DoctorInputs>, options: DiagnosticsRouteOptions = {}): ConnectionFetchRouteLike[] {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = options.now ?? (() => Date.now())
  let cached: { readonly at: number; readonly view: DoctorView } | null = null
  let inflight: Promise<DoctorView> | null = null

  const assemble = (): Promise<DoctorView> => {
    if (cached !== null && now() - cached.at < ttlMs) return Promise.resolve(cached.view)
    if (inflight !== null) return inflight
    inflight = (async (): Promise<DoctorView> => {
      try {
        const view = buildDoctorView(await getInputs())
        cached = { at: now(), view }
        return view
      } catch (error) {
        // A failed probe is not cached: the next request must be allowed to try again.
        return unavailableDoctorView(new Date(), error instanceof Error ? error.message : String(error))
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  return [{
    path: HOST_ROUTES.diagnostics.view,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method !== 'GET') return methodNotAllowed(['GET'])
      const view = await withBudget(assemble(), timeoutMs, () => unavailableDoctorView(new Date(), 'the diagnostics assembly exceeded its ' + String(timeoutMs) + ' ms budget; retry in a moment'))
      return json(200, { ok: true, data: view })
    },
  }]
}

/**
 * Race one promise against a budget without rejecting: an expired assembly answers the fallback.
 * The timer is always cleared, so a fast result leaves no pending timeout behind.
 * @param pending - the assembly in progress.
 * @param timeoutMs - how long the caller may wait.
 * @param fallback - the view to answer when the budget expires.
 * @returns the assembly result or the fallback.
 */
async function withBudget(pending: Promise<DoctorView>, timeoutMs: number, fallback: () => DoctorView): Promise<DoctorView> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<DoctorView>((resolve) => { timer = setTimeout(() => { resolve(fallback()) }, timeoutMs) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
