/**
 * The approval HTTP surface: four loopback routes over the write gate's pending window.
 *
 * Layering: this module maps a route to a USE CASE and does nothing else. The pending window itself
 * (ids, statuses, claim/resolve rules, the replay runners) lives in this package's service and in
 * `evolution-state-storage`; the routes only read the window and forward the two decisions, so the
 * console command face (`/evolution pending`, `approve <id>`) and this one cannot drift — both call
 * the same methods.
 *
 * The browser half never touches the state medium: it lists, it approves, it rejects.
 * @module @deepseek-ai/dsh-evolution-approval/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { PENDING_STATUSES } from '@deepseek-ai/dsh-evolution-state-storage'
import type { PendingKind, PendingRecord, PendingStatus } from '@deepseek-ai/dsh-evolution-state-storage'
import { elapsedSince, isLoopbackRequest, readJsonObject, textDiffFacts, writeJson } from '@deepseek-ai/dsh-evolution-core'
import type { WritePreview } from './index.ts'

/** Route paths. The browser half mirrors these literals; a spec asserts the two sides agree. */
export const APPROVAL_ROUTES = {
  pending: '/api/dsh-evolution/approval/pending',
  approve: '/api/dsh-evolution/approval/approve',
  reject: '/api/dsh-evolution/approval/reject',
  preview: '/api/dsh-evolution/approval/preview',
} as const

// S2.9/1-10: the statuses a caller may ask for are the SEAM'S own list (`PENDING_STATUSES` from
// evolution-state-storage), in the order the window moves through them — a literal here was the
// third copy of one vocabulary, and it could drift from the storage types without any error.

/** What one row of the pending list carries to the browser half. */
export interface PendingRow {
  readonly id: string
  readonly kind: PendingKind
  readonly summary: string
  readonly createdAt: string
  /** How long ago it was staged, in the family's `{unit, n}` closed vocabulary (the host owns the clock). */
  readonly age: ReturnType<typeof elapsedSince>
  readonly status: PendingStatus
  /** Present on a claimed-but-unfinished approve: the operator clears it by rejecting (doctor says so too). */
  readonly claimedBy?: string | undefined
}

/**
 * The slice of the approval service these routes read.
 *
 * Structural on purpose: a spec fixture implements it without constructing the service, and the
 * routes stay usable from any host that exposes the same three methods.
 */
export interface ApprovalFace {
  list(status?: PendingStatus): Promise<PendingRecord[]>
  approve(id: string): Promise<{ ok: boolean; message: string }>
  reject(id: string): Promise<{ ok: boolean; message: string }>
  /** The preview the replayer of that kind registered, when it registered one. */
  previewOf(kind: PendingKind): WritePreview | undefined
}

/**
 * Build the four routes over the approval service.
 * @param approval - the host's approval face (the service instance, or a spec fixture).
 * @returns the route list for `ctx.webServer.register`.
 */
export function makeApprovalRoutes(approval: ApprovalFace): WebRoute[] {
  /** Guard: trust fence, then method. Every refusal is a JSON body, never an empty response. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: 'method not allowed: ' + method })
      return false
    }
    return true
  }

  /**
   * Run one decision against the service.
   *
   * A refusal is a BUSINESS answer, not a transport failure: the body carries the service's own
   * sentence — the same one the console command prints — so the two faces cannot drift. A throw is
   * reported the same way rather than escaping as an empty 500, because the operator's next step
   * ("reject it", "retry") is only actionable if the reason is visible.
   */
  const decide = async (
    res: ServerResponse,
    run: (id: string) => Promise<{ ok: boolean; message: string }>,
    id: string,
  ): Promise<void> => {
    try {
      const result = await run(id)
      writeJson(res, 200, result.ok ? { ok: true, data: result } : { ok: false, code: 'approval-refused', message: result.message })
    } catch (error) {
      writeJson(res, 200, {
        ok: false,
        code: 'approval-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** The one shape a decision route accepts: a non-empty string id. */
  const idOf = (payload: Record<string, unknown> | null): string => typeof payload?.id === 'string' ? payload.id.trim() : ''

  return [
    {
      kind: 'exact',
      path: APPROVAL_ROUTES.pending,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const params = new URL(req.url ?? '/', 'http://loopback').searchParams
        const raw = params.get('status')?.trim() ?? ''
        const status = raw === '' ? 'pending' : raw
        if (!(PENDING_STATUSES as readonly string[]).includes(status)) {
          writeJson(res, 400, { ok: false, code: 'bad-request', message: 'status must be one of ' + PENDING_STATUSES.join(', ') })
          return
        }
        try {
          const records = await approval.list(status as PendingStatus)
          const rows: PendingRow[] = records.map(record => ({
            id: record.id,
            kind: record.kind,
            summary: record.summary,
            createdAt: record.createdAt,
            age: elapsedSince(record.createdAt, Date.now()),
            status: record.status,
            ...record.claimedBy === undefined ? {} : { claimedBy: record.claimedBy },
          }))
          writeJson(res, 200, { ok: true, data: rows })
        } catch (error) {
          writeJson(res, 200, {
            ok: false,
            code: 'approval-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: APPROVAL_ROUTES.preview,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const params = new URL(req.url ?? '/', 'http://loopback').searchParams
        const id = params.get('id')?.trim() ?? ''
        if (id === '') {
          writeJson(res, 400, { ok: false, code: 'bad-request', message: 'id is required' })
          return
        }
        try {
          // Both statuses: a record whose replay is already running is exactly when a reader asks.
          const staged = [...await approval.list('pending'), ...await approval.list('executing')]
          const record = staged.find(candidate => candidate.id === id)
          if (record === undefined) {
            writeJson(res, 200, { ok: false, code: 'not-found', message: 'no staged write with id "' + id + '"' })
            return
          }
          const preview = approval.previewOf(record.kind)
          if (preview === undefined) {
            // Not an error: plenty of staged writes have no bytes worth showing, and the reader is owed
            // the reason rather than an empty diff.
            writeJson(res, 200, { ok: true, data: { available: false, reason: 'a "' + record.kind + '" write has no preview' } })
            return
          }
          const answer = await preview(record.args)
          if (!answer.available) {
            writeJson(res, 200, { ok: true, data: { available: false, reason: answer.reason } })
            return
          }
          // The diff facts come from core's ONE implementation, the same one the history panel's diff
          // route uses: the two faces describe a change with the same numbers.
          const facts = textDiffFacts(answer.before ?? '', answer.after ?? '', answer.path)
          writeJson(res, 200, { ok: true, data: { available: true, path: answer.path, ...facts } })
        } catch (error) {
          writeJson(res, 200, {
            ok: false,
            code: 'approval-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: APPROVAL_ROUTES.approve,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const id = idOf(await readJsonObject(req))
        if (id === '') {
          writeJson(res, 400, { ok: false, code: 'bad-request', message: 'id is required' })
          return
        }
        await decide(res, current => approval.approve(current), id)
      },
    },
    {
      kind: 'exact',
      path: APPROVAL_ROUTES.reject,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const id = idOf(await readJsonObject(req))
        if (id === '') {
          writeJson(res, 400, { ok: false, code: 'bad-request', message: 'id is required' })
          return
        }
        await decide(res, current => approval.reject(current), id)
      },
    },
  ]
}
