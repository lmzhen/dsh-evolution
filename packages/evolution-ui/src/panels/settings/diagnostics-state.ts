/**
 * The diagnostics card's data face (W7 S7): ONE request to `HOST_ROUTES.diagnostics.view` through the
 * GENERATED route client, and the four-state answer the card renders.
 *
 * The Host route is the SAME `buildDoctorView` the CLI prints (W6/W8), so this client owns no facts
 * and no computation — it only renders.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client/diagnostics-state
 */
import { ROUTES } from '@lmzhen/dsh-evolution-client-kit/generated/routes'
import { requestJson, type RouteAnswer } from '@lmzhen/dsh-evolution-client-kit/generated/route-client'
import type { DiagnosticsView } from '@lmzhen/dsh-evolution-client-kit/generated/contracts'

/** What the card renders: the view, or the classified failure that kept it from arriving. */
export type DiagnosticsState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly view: DiagnosticsView }
  | { readonly phase: 'failed'; readonly failure: import('@lmzhen/dsh-evolution-client-kit/generated/route-client').RouteFailure }

/** The one call the card makes. */
export interface DiagnosticsApi {
  view(): Promise<RouteAnswer<DiagnosticsView>>
}

/**
 * Build the diagnostics face over one fetch implementation.
 * @param doFetch - the browser fetch, or a spec stub.
 */
export function createDiagnosticsApi(doFetch: typeof fetch = fetch): DiagnosticsApi {
  return {
    view: async () => await requestJson<DiagnosticsView>(doFetch, ROUTES.diagnostics.view, { headers: { accept: 'application/json' } }),
  }
}

