/**
 * The approval HTTP surface: four exact Fetch routes over the write gate's pending window.
 *
 * W6/G4: the carrier is the platform's Host connection data plane (`connection.fetch`) — the trust
 * fence, browser auth and owner-only admission are applied by the platform BEFORE `fetch(request)`
 * runs, so this module has no fence and no 403/401 branch. It still answers the same JSON envelope
 * the browser half reads; the loopback f-string that used to live here was a SECOND admission path
 * (the S2 spike showed it could diverge from the platform's).
 *
 * Layering: this module maps a route to a USE CASE and does nothing else. The pending window itself
 * (ids, statuses, claim/resolve rules, the replay runners) lives in this package's service and in
 * `evolution-state-storage`; the routes only read the window and forward the two decisions, so the
 * console command face (`/evolution pending`, `approve <id>`) and this one cannot drift — both call
 * the same methods.
 * @module @deepseek-ai/dsh-evolution-approval/routes
 */

import { PENDING_STATUSES } from '@deepseek-ai/dsh-evolution-state-storage'
import type { PendingKind, PendingRecord, PendingStatus } from '@deepseek-ai/dsh-evolution-state-storage'
import { elapsedSince, textDiffFacts } from '@deepseek-ai/dsh-evolution-core'
import { HOST_ROUTES, json, methodNotAllowed, readJsonObject } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { ConnectionFetchRouteLike, DecisionAudit } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { WritePreview } from './index.ts'

/** Route paths: the ONE declaration lives in core (W1) and the browser half is generated from it. */
export const APPROVAL_ROUTES = HOST_ROUTES.approval

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
 * W6: approve/reject take the DecisionAudit captured at registration (channel/principal/
 * deploymentAllowsRemote). The audit rides the service call so the ledger records the ONE admission
 * decision the platform already made — the route never re-derives it.
 */
export interface ApprovalFace {
  list(status?: PendingStatus): Promise<PendingRecord[]>
  approve(id: string, audit: DecisionAudit): Promise<{ ok: boolean; message: string }>
  reject(id: string, audit: DecisionAudit): Promise<{ ok: boolean; message: string }>
  /** The preview the replayer of that kind registered, when it registered one. */
  previewOf(kind: PendingKind): WritePreview | undefined
}

/**
 * Run one decision against the service.
 *
 * A refusal is a BUSINESS answer, not a transport failure: the body carries the service's own
 * sentence — the same one the console command prints — so the two faces cannot drift. A throw is
 * reported the same way rather than escaping as an empty 500, because the operator's next step
 * ("reject it", "retry") is only actionable if the reason is visible.
 */
async function decide(
  run: (id: string) => Promise<{ ok: boolean; message: string }>,
  id: string,
): Promise<Response> {
  try {
    const result = await run(id)
    return json(200, result.ok ? { ok: true, data: result } : { ok: false, code: 'approval-refused', message: result.message })
  } catch (error) {
    return json(200, {
      ok: false,
      code: 'approval-failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/** The one shape a decision route accepts: a non-empty string id. */
export function idOf(payload: Record<string, unknown> | null): string {
  return typeof payload?.id === 'string' ? payload.id.trim() : ''
}

/**
 * Build the four exact Fetch routes over the approval service.
 * @param approval - the host's approval face (the service instance, or a spec fixture).
 * @param audit - the DecisionAudit captured where the connection service is known (registration).
 * @returns the route list for `registerHostRoutes`.
 */
export function makeApprovalRoutes(approval: ApprovalFace, audit: DecisionAudit): ConnectionFetchRouteLike[] {
  return [
    {
      path: APPROVAL_ROUTES.pending,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method !== 'GET') return methodNotAllowed(['GET'])
        const params = new URL(request.url).searchParams
        const raw = params.get('status')?.trim() ?? ''
        const status = raw === '' ? 'pending' : raw
        if (!(PENDING_STATUSES as readonly string[]).includes(status)) {
          return json(400, { ok: false, code: 'bad-request', message: 'status 必须是以下之一：' + PENDING_STATUSES.join(', ') })
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
          return json(200, { ok: true, data: rows })
        } catch (error) {
          return json(200, {
            ok: false,
            code: 'approval-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      path: APPROVAL_ROUTES.preview,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method !== 'GET') return methodNotAllowed(['GET'])
        const params = new URL(request.url).searchParams
        const id = params.get('id')?.trim() ?? ''
        if (id === '') return json(400, { ok: false, code: 'bad-request', message: '缺少 id' })
        try {
          // Both statuses: a record whose replay is already running is exactly when a reader asks.
          const staged = [...await approval.list('pending'), ...await approval.list('executing')]
          const record = staged.find(candidate => candidate.id === id)
          if (record === undefined) {
            return json(200, { ok: false, code: 'not-found', message: '没有 id 为「' + id + '」的待批准写入' })
          }
          const preview = approval.previewOf(record.kind)
          if (preview === undefined) {
            // Not an error: plenty of staged writes have no bytes worth showing, and the reader is owed
            // the reason rather than an empty diff.
            return json(200, { ok: true, data: { available: false, reason: '类型 "' + record.kind + '" 的写入没有可预览内容' } })
          }
          const answer = await preview(record.args)
          if (!answer.available) return json(200, { ok: true, data: { available: false, reason: answer.reason } })
          // The diff facts come from core's ONE implementation, the same one the history panel's diff
          // route uses: the two faces describe a change with the same numbers.
          const facts = textDiffFacts(answer.before ?? '', answer.after ?? '', answer.path)
          return json(200, { ok: true, data: { available: true, path: answer.path, ...facts } })
        } catch (error) {
          return json(200, {
            ok: false,
            code: 'approval-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      path: APPROVAL_ROUTES.approve,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method !== 'POST') return methodNotAllowed(['POST'])
        const id = idOf(await readJsonObject(request))
        if (id === '') return json(400, { ok: false, code: 'bad-request', message: '缺少 id' })
        return await decide(current => approval.approve(current, audit), id)
      },
    },
    {
      path: APPROVAL_ROUTES.reject,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method !== 'POST') return methodNotAllowed(['POST'])
        const id = idOf(await readJsonObject(request))
        if (id === '') return json(400, { ok: false, code: 'bad-request', message: '缺少 id' })
        return await decide(current => approval.reject(current, audit), id)
      },
    },
  ]
}
