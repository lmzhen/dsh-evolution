/**
 * Four read-only merge routes: view / rows / body / history.
 * The host loads rows and runs; these handlers only project wire envelopes.
 */
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { HOST_ROUTES, json, methodNotAllowed, type ConnectionFetchRouteLike, type DecisionAudit } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { MergeRow } from './contracts.ts'
import { buildFacts as buildLegacyFacts } from './facts.ts'
import { toBodyView, toHistoryView, toQueuePage } from './wire-projection.ts'
import type { QueueId } from './wire.ts'
import type { StateReadiness } from './domain/state-bootstrap.ts'
import type { MergeSnapshot, BodyRef } from './domain/merge-snapshot.ts'
import { buildBodyView, buildFacts as buildSnapshotFacts, buildHistoryView, buildQueuePage } from './surface/merge-view.ts'

const MERGE_PATHS = HOST_ROUTES.merge as { view: string; rows: string; body?: string; history?: string }
const MERGE_BASE = MERGE_PATHS.view.slice(0, -'view'.length)
export const MERGE_ROUTES: { view: `/api/dsh-evolution/${string}`; rows: `/api/dsh-evolution/${string}`; body: `/api/dsh-evolution/${string}`; history: `/api/dsh-evolution/${string}` } = {
  view: MERGE_PATHS.view as `/api/dsh-evolution/${string}`,
  rows: MERGE_PATHS.rows as `/api/dsh-evolution/${string}`,
  body: (MERGE_PATHS.body ?? MERGE_BASE + 'body') as `/api/dsh-evolution/${string}`,
  history: (MERGE_PATHS.history ?? MERGE_BASE + 'history') as `/api/dsh-evolution/${string}`,
}

export interface MergeHistoryItem {
  readonly name: string
  readonly kind: 'merged' | 'deleted' | 'split' | 'other'
  readonly reason: string
  readonly lastVersion: number
  readonly archivedAt: string
  readonly sourceRunId?: string
}

export interface MergeRouteSource {
  snapshot?(): Promise<MergeSnapshot>
  bodyRef?(ref: BodyRef): Promise<string | null>
  rows?(): Promise<readonly MergeRow[]>
  run?(id: string): Promise<RunRecord | undefined>
  runs?(cursor?: string, limit?: number): Promise<readonly RunRecord[]>
  body?(id: string, side: 'a' | 'b'): Promise<string | null>
  history?(): Promise<readonly MergeHistoryItem[]>
  commands(): readonly string[]
  approval?(): boolean
  readiness?(): Promise<StateReadiness>
}

export function makeMergeRoutes(
  deps: { getSource: () => MergeRouteSource | undefined },
  _audit: DecisionAudit,
): ConnectionFetchRouteLike[] {
  const absent = () => json(404, { wireVersion: 1, code: 'E-325', message: 'merge service is not mounted' })
  const blocked = (readiness: StateReadiness) => json(503, { wireVersion: 1, code: 'merge-state-blocked', readiness })
  const hostOnly = (snapshot: MergeSnapshot): Response | null => snapshot.hostOnly === undefined ? null : json(503, { wireVersion: 1, code: 'E-323', message: snapshot.hostOnly.detail ?? 'host data plane unavailable' })
  const notReady = async (source: MergeRouteSource): Promise<Response | null> => {
    if (source.readiness === undefined) return null
    const readiness = await source.readiness()
    return readiness.ok ? null : blocked(readiness)
  }
  const bad = (message: string) => json(400, { wireVersion: 1, code: 'merge-bad-query', message })
  const get = (request: Request): Response | null => (request.method === 'GET' ? null : methodNotAllowed(['GET']))
  const url = (request: Request): URL => new URL(request.url, 'http://local')
  return [
    {
      path: MERGE_ROUTES.view,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const denied = get(request)
        if (denied !== null) return denied
        const source = deps.getSource()
        if (source === undefined) return absent()
        if (source.snapshot !== undefined) {
          const snapshot = await source.snapshot()
          if (snapshot.blocked !== undefined) return json(503, { wireVersion: 1, code: 'merge-state-blocked', readiness: snapshot.blocked.readiness })
          const capability = hostOnly(snapshot)
          if (capability !== null) return capability
          return json(200, buildSnapshotFacts(snapshot))
        }
        const readiness = await notReady(source)
        if (readiness !== null) return readiness
        const readAt = Date.now()
        const rows = await source.rows?.() ?? []
        const runs = await source.runs?.(undefined, 20) ?? []
        return json(200, buildLegacyFacts({ rows, runs, approval: source.approval?.() === true, readAt }))
      },
    },
    {
      path: MERGE_ROUTES.rows,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const denied = get(request)
        if (denied !== null) return denied
        const source = deps.getSource()
        if (source === undefined) return absent()
        const query = url(request).searchParams
        const queue = query.get('queue') ?? 'verify'
        if (queue !== 'verify' && queue !== 'pending' && queue !== 'fuse' && queue !== 'skipped') return bad('queue must be verify/pending/fuse/skipped')
        const expiredOnly = query.get('expired') === '1'
        if (expiredOnly && queue !== 'pending') return bad('expired is only allowed for pending')
        const limit = Number.parseInt(query.get('limit') ?? '50', 10)
        if (source.snapshot !== undefined) {
          const snapshot = await source.snapshot()
          if (snapshot.blocked !== undefined) return json(503, { wireVersion: 1, code: 'merge-state-blocked', readiness: snapshot.blocked.readiness })
          const capability = hostOnly(snapshot)
          if (capability !== null) return capability
          try { return json(200, buildQueuePage(snapshot, queue as QueueId, expiredOnly, query.get('cursor') ?? undefined, Number.isFinite(limit) ? limit : 50)) } catch (error) { return bad(error instanceof Error ? error.message : 'queue cursor is stale') }
        }
        const readiness = await notReady(source)
        if (readiness !== null) return readiness
        const offset = Number.parseInt(query.get('cursor') ?? '0', 10)
        const rows = await source.rows?.() ?? []
        const page = toQueuePage(rows, queue as QueueId, expiredOnly, Date.now(), Number.isFinite(limit) ? limit : 50)
        return json(200, Number.isFinite(offset) && offset > 0 ? { ...page, rows: page.rows.slice(offset) } : page)
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
        if (id !== null && name !== null) return bad('id and name are mutually exclusive')
        if ((id === null || id === '') && (name === null || name === '')) return json(404, { wireVersion: 1, code: 'merge-body-not-found', message: 'merge body requires id or name' })
        if (source.snapshot !== undefined) {
          const snapshot = await source.snapshot()
          if (snapshot.blocked !== undefined) return json(503, { wireVersion: 1, code: 'merge-state-blocked', readiness: snapshot.blocked.readiness })
          // Body/history are read-only projections of already-written files; a host without
          // the live agent data plane can still read past reports and archived bodies.
          const refs = id !== null && id !== '' ? snapshot.bodyRefs.filter(ref => ref.rowId === id) : snapshot.bodyRefs.filter(ref => ref.name === name)
          if (refs.length === 0) return json(404, { wireVersion: 1, code: 'merge-body-not-found', message: 'merge body not found' })
          if (name !== null && refs.length > 1) return bad('name matches multiple merge rows')
          const row = snapshot.rows.find(item => item.row.id === refs[0]!.rowId)
          if (row?.stage?.state === 'lost' || row?.stage?.state === 'expired') return json(404, { wireVersion: 1, code: 'merge-body-not-found', message: 'merge stage is lost' })
          const sideFilter = side === 'a' ? 'live' : side === 'b' ? 'archive' : side === 'live' || side === 'archive' ? side : undefined
          const ref = (sideFilter === undefined ? refs[0] : refs.find(item => item.side === sideFilter)) ?? refs[0]!
          const content = source.bodyRef === undefined ? null : await source.bodyRef(ref)
          return json(200, buildBodyView(snapshot, ref, content ?? ''))
        }
        const readiness = await notReady(source)
        if (readiness !== null) return readiness
        if (id === null || id === '' || (side !== 'a' && side !== 'b')) return bad('id and side=a|b are required')
        const content = await source.body?.(id, side) ?? null
        return content === null
          ? json(200, { wireVersion: 1, code: 'merge-body-missing', message: 'merge body not found: ' + id })
          : json(200, toBodyView(id, side === 'a' ? 'live' : 'archive', content, Date.now()))
      },
    },
    {
      path: MERGE_ROUTES.history,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const denied = get(request)
        if (denied !== null) return denied
        const source = deps.getSource()
        if (source === undefined) return absent()
        if (source.snapshot !== undefined) {
          const snapshot = await source.snapshot()
          if (snapshot.blocked !== undefined) return json(503, { wireVersion: 1, code: 'merge-state-blocked', readiness: snapshot.blocked.readiness })
          return json(200, buildHistoryView(snapshot))
        }
        const readiness = await notReady(source)
        if (readiness !== null) return readiness
        return json(200, toHistoryView(await source.history?.() ?? [], Date.now()))
      },
    },
  ]
}
