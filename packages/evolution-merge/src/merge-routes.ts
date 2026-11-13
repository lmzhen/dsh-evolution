/**
 * Four read-only merge routes: view / rows / body / history.
 * The host loads one snapshot; these handlers only project wire envelopes.
 * There is no second (legacy rows/runs/history) source: the production constructor has
 * always provided the snapshot, and the legacy branches were the only consumers of
 * facts.ts / wire-projection.ts (W11 D2b).
 */
import { HOST_ROUTES, json, methodNotAllowed, type ConnectionFetchRouteLike, type DecisionAudit } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { QueueId } from './wire.ts'
import type { MergeSnapshot, BodyRef } from './domain/merge-snapshot.ts'
import { buildBodyView, buildFacts as buildSnapshotFacts, buildHistoryView, buildQueuePage } from './surface/merge-view.ts'

const MERGE_PATHS = HOST_ROUTES.merge as { view: string; rows: string; body?: string; history?: string }
const MERGE_BASE = MERGE_PATHS.view.slice(0, -'view'.length)
export const MERGE_ROUTES: { view: `/api/dsh-evolution/${string}`; rows: `/api/dsh-evolution/${string}`; body: `/api/dsh-evolution/${string}`; history: `/api/dsh-evolution/${string}`; decision: `/api/dsh-evolution/${string}` } = {
  view: MERGE_PATHS.view as `/api/dsh-evolution/${string}`,
  rows: MERGE_PATHS.rows as `/api/dsh-evolution/${string}`,
  body: (MERGE_PATHS.body ?? MERGE_BASE + 'body') as `/api/dsh-evolution/${string}`,
  history: (MERGE_PATHS.history ?? MERGE_BASE + 'history') as `/api/dsh-evolution/${string}`,
  decision: (MERGE_BASE + 'decision') as `/api/dsh-evolution/${string}`,
}

export interface MergeDecisionRequest {
  readonly rowId: string
  readonly verb: 'approve' | 'reject'
  readonly sessionId: string
}

export interface MergeDecisionResult {
  readonly ok: boolean
  readonly message: string
  readonly code?: string
  readonly runId?: string
}

export interface MergeRouteSource {
  snapshot(): Promise<MergeSnapshot>
  bodyRef?(ref: BodyRef): Promise<string | null>
}

export function makeMergeRoutes(
  deps: {
    getSource: () => MergeRouteSource | undefined
    decide?: (request: MergeDecisionRequest, audit: DecisionAudit) => Promise<MergeDecisionResult>
  },
  _audit: DecisionAudit,
): ConnectionFetchRouteLike[] {
  const absent = () => json(404, { wireVersion: 1, code: 'E-325', message: 'merge service is not mounted' })
  const blocked = (snapshot: MergeSnapshot): Response | null => snapshot.blocked === undefined ? null : json(503, { wireVersion: 1, code: 'merge-state-blocked', readiness: snapshot.blocked.readiness })
  const hostOnly = (snapshot: MergeSnapshot): Response | null => snapshot.hostOnly === undefined ? null : json(503, { wireVersion: 1, code: 'E-323', message: snapshot.hostOnly.detail ?? 'host data plane unavailable' })
  const bad = (message: string) => json(400, { wireVersion: 1, code: 'merge-bad-query', message })
  const get = (request: Request): Response | null => (request.method === 'GET' ? null : methodNotAllowed(['GET']))
  const url = (request: Request): URL => new URL(request.url, 'http://local')
  const snapshotOf = async (): Promise<MergeSnapshot | null> => {
    const source = deps.getSource()
    return source === undefined ? null : await source.snapshot()
  }
  const unavailable = (snapshot: MergeSnapshot | null): Response | null => snapshot === null ? absent() : blocked(snapshot) ?? hostOnly(snapshot)
  return [
    {
      path: MERGE_ROUTES.view,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const denied = get(request)
        if (denied !== null) return denied
        const snapshot = await snapshotOf()
        const notReady = unavailable(snapshot)
        if (notReady !== null) return notReady
        return json(200, buildSnapshotFacts(snapshot as MergeSnapshot))
      },
    },
    {
      path: MERGE_ROUTES.rows,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const denied = get(request)
        if (denied !== null) return denied
        const query = url(request).searchParams
        const queue = query.get('queue') ?? 'verify'
        if (queue !== 'verify' && queue !== 'pending' && queue !== 'fuse' && queue !== 'skipped') return bad('queue must be verify/pending/fuse/skipped')
        const expiredOnly = query.get('expired') === '1'
        if (expiredOnly && queue !== 'pending') return bad('expired is only allowed for pending')
        const limit = Number.parseInt(query.get('limit') ?? '50', 10)
        const snapshot = await snapshotOf()
        const notReady = unavailable(snapshot)
        if (notReady !== null) return notReady
        try { return json(200, buildQueuePage(snapshot as MergeSnapshot, queue as QueueId, expiredOnly, query.get('cursor') ?? undefined, Number.isFinite(limit) ? limit : 50)) } catch (error) { return bad(error instanceof Error ? error.message : 'queue cursor is stale') }
      },
    },
    {
      path: MERGE_ROUTES.body,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const denied = get(request)
        if (denied !== null) return denied
        const source = deps.getSource()
        if (source === undefined) return absent()
        const query = url(request).searchParams
        const id = query.get('id')
        const name = query.get('name')
        const side = query.get('side')
        if ((id === null || id === '') && (name === null || name === '')) return json(404, { wireVersion: 1, code: 'merge-body-not-found', message: 'merge body requires id or name' })
        const snapshot = await source.snapshot()
        const notReady = blocked(snapshot)
        if (notReady !== null) return notReady
        // Body/history are read-only projections of already-written files; a host without
        // the live agent data plane can still read past reports and archived bodies.
        const sideFilter = side === 'a' ? 'live' : side === 'b' ? 'archive' : side === 'live' || side === 'archive' ? side : undefined
        const refs = snapshot.bodyRefs.filter(ref =>
          (id === null || id === '' || ref.rowId === id)
          && (name === null || name === '' || ref.name === name)
          && (sideFilter === undefined || ref.side === sideFilter))
        if (refs.length === 0) return json(404, { wireVersion: 1, code: 'merge-body-not-found', message: 'merge body not found' })
        if (refs.length > 1) return bad('merge body is ambiguous; pass id, name and side')
        const row = snapshot.rows.find(item => item.row.id === refs[0]!.rowId)
        if (row?.stage?.state === 'lost' || row?.stage?.state === 'expired') return json(404, { wireVersion: 1, code: 'merge-body-not-found', message: 'merge stage is lost' })
        const ref = refs[0]!
        const content = source.bodyRef === undefined ? null : await source.bodyRef(ref)
        return json(200, buildBodyView(snapshot, ref, content ?? ''))
      },
    },
    {
      path: MERGE_ROUTES.history,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const denied = get(request)
        if (denied !== null) return denied
        const snapshot = await snapshotOf()
        if (snapshot === null) return absent()
        const notReady = blocked(snapshot)
        if (notReady !== null) return notReady
        return json(200, buildHistoryView(snapshot))
      },
    },
    {
      path: MERGE_ROUTES.decision,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method !== 'POST') return methodNotAllowed(['POST'])
        if (deps.decide === undefined) return absent()
        let body: unknown
        try { body = await request.json() } catch { return bad('decision body must be JSON') }
        if (typeof body !== 'object' || body === null) return bad('decision body must be an object')
        const input = body as { rowId?: unknown; verb?: unknown; sessionId?: unknown }
        if (typeof input.rowId !== 'string' || input.rowId === '') return bad('rowId is required')
        if (input.verb !== 'approve' && input.verb !== 'reject') return bad('verb must be approve or reject')
        if (typeof input.sessionId !== 'string' || input.sessionId === '') return bad('sessionId is required')
        const result = await deps.decide({ rowId: input.rowId, verb: input.verb, sessionId: input.sessionId }, _audit)
        return json(result.ok ? 200 : result.code === 'E-305' ? 409 : 400, { wireVersion: 1, ...result })
      },
    },
  ]
}
