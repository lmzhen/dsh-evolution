/**
 * G6/W8: the diagnostics Host route — the browser face of the SAME DiagnosticsView the CLI prints.
 *
 * Registration belongs to W6 (`registerHostRoutes` is called by the commands plugin's apply), so
 * this module only supplies the handler. A failed input assembly is NOT a transport error: the
 * handler answers an all-unknown view naming the failure, because doctor must never throw (W8 §6).
 * @module @deepseek-ai/dsh-evolution-commands/diagnostics-route
 */
import { HOST_ROUTES, json, methodNotAllowed } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { ConnectionFetchRouteLike } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { buildDoctorView, unavailableDoctorView, type DoctorInputs } from './doctor-view.ts'

/**
 * Build the diagnostics route over one input producer.
 * @param getInputs - assembles the live view inputs (soft probes; may reject).
 * @returns the exact Fetch route for `HOST_ROUTES.diagnostics.view`.
 */
export function makeDiagnosticsRoutes(getInputs: () => Promise<DoctorInputs>): ConnectionFetchRouteLike[] {
  return [{
    path: HOST_ROUTES.diagnostics.view,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method !== 'GET') return methodNotAllowed(['GET'])
      try {
        return json(200, { ok: true, data: buildDoctorView(await getInputs()) })
      } catch (error) {
        return json(200, { ok: true, data: unavailableDoctorView(new Date(), error instanceof Error ? error.message : String(error)) })
      }
    },
  }]
}
