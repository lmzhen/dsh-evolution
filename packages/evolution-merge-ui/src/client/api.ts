/**
 * The two read routes this panel uses, through the generated client route table and the
 * shared route client. A refusal keeps the host's own sentence.
 */
import { ROUTES } from './routes.generated.ts'
import { requestJson, type RouteFailure } from './route-client.generated.ts'

export const HOST_ROUTES = ROUTES.merge

export type MergeQueue = 'verify' | 'pending' | 'fuse' | 'skipped'

export interface MergeCounts {
  verify: number
  pending: number
  fuse: number
  skipped: number
}

export interface MergeRunView {
  id: string
  state: string
  command?: string
  stage?: string
  progress?: { done: number; total: number }
  startedAt: number
}

export interface MergeViewPayload {
  schemaVersion?: number
  counts: MergeCounts
  tabs: { queue: MergeQueue; count: number }[]
  commands: string[]
  latestRun?: MergeRunView
  approval?: boolean
}

export interface MergeRowView {
  id: string
  pairKey: string
  a: string
  b: string
  state: string
  queue: MergeQueue
  stage: string | null
  label: string
  updatedAt: string
  createdAt?: string
  target?: string
  confidence?: number
  failure?: { stage: string; code: string; message: string; retryable: boolean }
  attempts?: number
  origin?: 'agent' | 'human'
  stagingExpiresAt?: number
  expired?: 'target-taken' | 'source-changed'
  reason?: string
  summary?: string[]
  actions?: string[]
}

export interface QueuePage {
  queue: MergeQueue
  items: MergeRowView[]
  nextCursor?: string
}

export interface MergeBody {
  content: string
  markdown: boolean
  html: string
}

export interface MergeHistoryItem {
  name: string
  kind: 'merged' | 'deleted' | 'split' | 'other'
  reason: string
  lastVersion: number
  archivedAt: string
  sourceRunId?: string
}

export type MergeOutcome<T> = { ok: true; payload: T } | { ok: false; failure: RouteFailure }

export async function view(): Promise<MergeOutcome<MergeViewPayload>> {
  const answer = await requestJson<MergeViewPayload>(fetch, HOST_ROUTES.view, { headers: { accept: 'application/json' } })
  return answer.ok ? { ok: true, payload: answer.data } : { ok: false, failure: answer.failure }
}

export async function rows(queue: MergeQueue, cursor = 0): Promise<MergeOutcome<QueuePage>> {
  const url = HOST_ROUTES.rows + '?queue=' + encodeURIComponent(queue) + '&cursor=' + String(cursor)
  const answer = await requestJson<QueuePage>(fetch, url, { headers: { accept: 'application/json' } })
  return answer.ok ? { ok: true, payload: answer.data } : { ok: false, failure: answer.failure }
}

export async function body(id: string, side: 'a' | 'b'): Promise<MergeOutcome<MergeBody>> {
  const url = HOST_ROUTES.body + '?id=' + encodeURIComponent(id) + '&side=' + side
  const answer = await requestJson<MergeBody>(fetch, url, { headers: { accept: 'application/json' } })
  return answer.ok ? { ok: true, payload: answer.data } : { ok: false, failure: answer.failure }
}

export async function history(): Promise<MergeOutcome<{ items: MergeHistoryItem[] }>> {
  const answer = await requestJson<{ items: MergeHistoryItem[] }>(fetch, HOST_ROUTES.history, { headers: { accept: 'application/json' } })
  return answer.ok ? { ok: true, payload: answer.data } : { ok: false, failure: answer.failure }
}
