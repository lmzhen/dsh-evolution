/**
 * Four read-only merge routes: view / rows / run / runs. The host loads rows and runs; these
 * handlers only project. A missing merge service answers 503 instead of pretending empty.
 */
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { json, methodNotAllowed, type ConnectionFetchRouteLike, type DecisionAudit } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { MergeQueue, MergeRow } from './contracts.ts'
import { buildMergeView, pageQueue, toRunFact } from './routes.ts'

export const MERGE_ROUTES = {
  view: '/api/dsh-evolution/merge/view',
  rows: '/api/dsh-evolution/merge/rows',
  run: '/api/dsh-evolution/merge/run',
  runs: '/api/dsh-evolution/merge/runs',
} as const

export interface MergeRouteSource {
  rows(): Promise<readonly MergeRow[]>
  run(id: string): Promise<RunRecord | undefined>
  runs(cursor?: string, limit?: number): Promise<readonly RunRecord[]>
  commands(): readonly string[]
}

export function makeMergeRoutes(
  deps: { getSource: () => MergeRouteSource | undefined },
  _audit: DecisionAudit,
): ConnectionFetchRouteLike[] {
  const absent = () => json(503, { ok: false, error: { code: 'merge-service-absent', message: 'merge service is not mounted' } })
  const get = async (request: Request): Promise<Response | null> => (request.method === 'GET' ? null : methodNotAllowed(['GET']))
  const url = (request: Request): URL => new URL(request.url, 'http://local')
  return [
    {
      path: MERGE_ROUTES.view,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const denied = await get(request)
        if (denied !== null) return denied
        const source = deps.getSource()
        if (source === undefined) return absent()
        return json(200, { ok: true, data: buildMergeView(await source.rows(), source.commands()) })
      },
    },
    {
      path: MERGE_ROUTES.rows,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const denied = await get(request)
        if (denied !== null) return denied
        const source = deps.getSource()
        if (source === undefined) return absent()
        const query = url(request).searchParams
        const queue = query.get('queue') ?? 'retry'
        if (queue !== 'pending' && queue !== 'retry' && queue !== 'skipped') {
          return json(400, { ok: false, error: { code: 'bad-queue', message: 'queue must be pending/retry/skipped' } })
        }
        const cursor = Number.parseInt(query.get('cursor') ?? '0', 10)
        const limit = Number.parseInt(query.get('limit') ?? '50', 10)
        return json(200, { ok: true, data: pageQueue(await source.rows(), queue as MergeQueue, Number.isFinite(cursor) ? cursor : 0, Number.isFinite(limit) ? limit : 50) })
      },
    },
    {
      path: MERGE_ROUTES.run,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const denied = await get(request)
        if (denied !== null) return denied
        const source = deps.getSource()
        if (source === undefined) return absent()
        const id = url(request).searchParams.get('id')
        if (id === null || id === '') return json(400, { ok: false, error: { code: 'missing-id', message: 'id is required' } })
        const run = await source.run(id)
        return run === undefined
          ? json(404, { ok: false, error: { code: 'run-not-found', message: 'merge run not found: ' + id } })
          : json(200, { ok: true, data: toRunFact(run) })
      },
    },
    {
      path: MERGE_ROUTES.runs,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const denied = await get(request)
        if (denied !== null) return denied
        const source = deps.getSource()
        if (source === undefined) return absent()
        const query = url(request).searchParams
        const limit = Number.parseInt(query.get('limit') ?? '20', 10)
        const runs = await source.runs(query.get('cursor') ?? undefined, Number.isFinite(limit) ? limit : 20)
        return json(200, { ok: true, data: { items: runs.map(toRunFact) } })
      },
    },
  ]
}
