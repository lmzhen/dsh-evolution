/**
 * Four read-only merge routes: view / rows / run / runs. The host loads rows and runs; these
 * handlers only project. A missing merge service answers 503 instead of pretending empty.
 */
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { HOST_ROUTES, json, methodNotAllowed, type ConnectionFetchRouteLike, type DecisionAudit } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { MergeRow } from './contracts.ts'
import { buildMergeView, pageQueue, toRunFact } from './routes.ts'
import { renderMarkdown } from './domain/markdown.ts'

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
  const absent = () => json(503, { ok: false, error: { code: 'merge-service-absent', message: 'merge service is not mounted' } })
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
        const runs = await source.runs(undefined, 20)
        const latestMerge = runs.find(run => run.kind === 'merge')
        return json(200, {
          ok: true,
          data: buildMergeView(
            await source.rows(),
            source.commands(),
            latestMerge === undefined ? undefined : toRunFact(latestMerge),
            source.approval?.(),
          ),
        })
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
        if (queue !== 'verify' && queue !== 'pending' && queue !== 'fuse' && queue !== 'skipped') {
          return json(400, { ok: false, error: { code: 'bad-queue', message: 'queue must be verify/pending/fuse/skipped' } })
        }
        const cursor = Number.parseInt(query.get('cursor') ?? '0', 10)
        const limit = Number.parseInt(query.get('limit') ?? '50', 10)
        return json(200, {
          ok: true,
          data: pageQueue(await source.rows(), queue, Number.isFinite(cursor) ? cursor : 0, Number.isFinite(limit) ? limit : 50),
        })
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
        if (id === null || id === '' || (side !== 'a' && side !== 'b')) {
          return json(400, { ok: false, error: { code: 'bad-body-query', message: 'id and side=a|b are required' } })
        }
        const content = await source.body(id, side)
        return content === null
          ? json(404, { ok: false, error: { code: 'body-not-found', message: 'merge body not found: ' + id } })
          : json(200, { ok: true, data: { content, markdown: true, html: renderMarkdown(content) } })
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
        return json(200, { ok: true, data: { items: await source.history() } })
      },
    },
  ]
}
