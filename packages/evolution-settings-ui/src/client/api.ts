/**
 * The approval routes this bundle calls, and the ONE place a request is made.
 *
 * Structural types on purpose: the browser half cannot import the host package at runtime, so the row
 * shape is declared by what the route hands over. Every answer — including a refusal — is parsed the
 * same way, because a refusal is a business answer the card shows as a sentence, not a transport error.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client/api
 */
import { ROUTES } from './routes.generated.ts'
import { failureMessage, requestJson, type RouteAnswer } from './route-client.generated.ts'

/** One staged write, as the pending route hands it over (never the staged args). */
export interface PendingRow {
  readonly id: string
  readonly kind: 'memory' | 'skill' | 'capability'
  readonly summary: string
  readonly createdAt: string
  /** How long ago it was staged, in the family's `{unit, n}` closed vocabulary. */
  readonly age: { readonly unit: string; readonly n: number }
  readonly status: 'pending' | 'executing' | 'approved' | 'rejected'
  readonly claimedBy?: string | undefined
}

/** One windowed hunk of a previewed change: the region the write would touch. */
export interface PreviewHunk {
  readonly path: string
  readonly oldText: string
  readonly newText: string
}

/**
 * What a staged write WOULD store. `available: false` carries the host's reason — plenty of records have
 * no bytes worth showing, and the reader is owed that sentence rather than an empty diff.
 */
export type PreviewAnswer =
  | {
    readonly available: true
    readonly path: string
    readonly linesAdded: number
    readonly linesRemoved: number
    readonly hunks: readonly PreviewHunk[]
    readonly truncated: boolean
  }
  | { readonly available: false; readonly reason: string }

/** What one call answered: the data, or the reason it could not be carried out. */
export type ApprovalAnswer<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly message: string }

/**
 * Which window the pending route is asked for. The host route has always taken `?status=` (the CLI
 * asks for both); this half asked for neither, so a record stuck in `executing` — an approve that
 * died between the claim and the decision, or another process running it — was invisible in the GUI
 * while `/evolution pending` and doctor both listed it (T4-05/A47). `PendingRow.status` even declared
 * the member, so the type face expected data the data face could not reach.
 */
export type PendingWindow = 'pending' | 'executing'

/** How this bundle reaches the host. Injectable so a spec drives it without a server. */
export interface ApprovalApi {
  /** The staged writes in one window; `pending` when the caller does not say. */
  pending: (status?: PendingWindow) => Promise<ApprovalAnswer<readonly PendingRow[]>>
  /** Ask the host to replay one staged write. */
  approve: (id: string) => Promise<ApprovalAnswer<unknown>>
  /** Close one staged write without replaying it. */
  reject: (id: string) => Promise<ApprovalAnswer<unknown>>
  /** What that staged write would store, resolved by the host without running it. */
  preview: (id: string) => Promise<ApprovalAnswer<PreviewAnswer>>
}

/** Flatten the shared four-state answer onto this card's historical {ok,message} surface. */
function unwrap<T>(answer: RouteAnswer<T>): ApprovalAnswer<T> {
  return answer.ok ? { ok: true, data: answer.data } : { ok: false, message: failureMessage(answer.failure) }
}

/**
 * Build the approval face over one fetch implementation.
 * @param doFetch - the fetch to use (the platform's global in the browser, a fake in a spec).
 * @returns the three calls the pending card makes.
 */
export function createApprovalApi(doFetch: typeof fetch): ApprovalApi {
  const post = async (path: string, id: string): Promise<ApprovalAnswer<unknown>> =>
    unwrap(await requestJson(doFetch, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }))
  return {
    pending: async status => unwrap(await requestJson<readonly PendingRow[]>(
      doFetch,
      status === undefined ? ROUTES.approval.pending : ROUTES.approval.pending + '?status=' + status,
    )),
    approve: async id => await post(ROUTES.approval.approve, id),
    reject: async id => await post(ROUTES.approval.reject, id),
    preview: async id => unwrap(await requestJson<PreviewAnswer>(doFetch, ROUTES.approval.preview + '?id=' + encodeURIComponent(id))),
  }
}
