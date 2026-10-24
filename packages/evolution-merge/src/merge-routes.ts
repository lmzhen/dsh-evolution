/**
 * Four read-only merge routes: view / rows / body / history.
 * The host loads rows and runs; these handlers only project wire envelopes.
 */
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { HOST_ROUTES, json, methodNotAllowed, type ConnectionFetchRouteLike, type DecisionAudit } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { MergeRow } from './contracts.ts'
import { buildFacts } from './facts.ts'
import { toBodyView, toHistoryView, toQueuePage } from './wire-projection.ts'
import type { QueueId } from './wire.ts'

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
  rows(): Promise<readonly MergeRow[]>
  run(id: string): Promise<RunRecord | undefined>
  runs(cursor?: string, limit?: number): Promise<readonly RunRecord[]>
  body(id: string, side: 'a' | 'b'): Promise<string | null>
  history(): Promise<readonly MergeHistoryItem[]>
  commands(): readonly string[]
  approval?(): boolean
}

export function makeMergeRoutes(
  deps: { getSource: () => MergeRouteSource | undefined },
  _audit: DecisionAudit,
): ConnectionFetchRouteLike[] {
  const absent = () => json(404, { wireVersion: 1, code: 'E-325', message: 'merge service is not mounted' })
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
        const readAt = Date.now()
        const rows = await source.rows()
        const runs = await source.runs(undefined, 20)
        return json(200, buildFacts({ rows, runs, approval: source.approval?.() === true, readAt }))
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
        const offset = Number.parseInt(query.get('cursor') ?? '0', 10)
        const rows = await source.rows()
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
        const side = query.get('side')
        if (id === null || id === '' || (side !== 'a' && side !== 'b')) return bad('id and side=a|b are required')
        const content = await source.body(id, side)
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
        return json(200, toHistoryView(await source.history(), Date.now()))
      },
    },
  ]
}
