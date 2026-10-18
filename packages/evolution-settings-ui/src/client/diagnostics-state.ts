/**
 * The diagnostics card's data face (W7 S7): ONE request to `HOST_ROUTES.diagnostics.view` through the
 * GENERATED route client, and the four-state answer the card renders.
 *
 * The Host route is the SAME `buildDoctorView` the CLI prints (W6/W8), so this client owns no facts
 * and no computation — it only renders.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client/diagnostics-state
 */
import { ROUTES } from './routes.generated.ts'
import { requestJson, type RouteAnswer } from './route-client.generated.ts'
import type { DiagnosticsView } from './contracts.generated.ts'

/** What the card renders: the view, or the classified failure that kept it from arriving. */
export type DiagnosticsState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly view: DiagnosticsView }
  | { readonly phase: 'failed'; readonly failure: import('./route-client.generated.ts').RouteFailure }

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

/**
 * Read the view once and map it onto the card's four states (loading is the caller's initial value).
 * @param doFetch - the fetch to use.
 * @returns ready with the view, or failed with the classified failure.
 */
export async function loadDiagnostics(doFetch: typeof fetch = fetch): Promise<DiagnosticsState> {
  const answer = await createDiagnosticsApi(doFetch).view()
  return answer.ok ? { phase: 'ready', view: answer.data } : { phase: 'failed', failure: answer.failure }
}
