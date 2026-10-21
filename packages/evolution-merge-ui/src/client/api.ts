/**
 * The two read routes this panel uses, through the generated client route table and the
 * shared route client. A refusal keeps the host's own sentence.
 */
import { ROUTES } from './routes.generated.ts'
import { requestJson, type RouteFailure } from './route-client.generated.ts'

export const HOST_ROUTES = ROUTES.merge

export type MergeQueue = 'pending' | 'retry' | 'skipped'

export interface MergeCounts {
  pending: number
  retry: number
  skipped: number
}

export interface MergeViewPayload {
  schemaVersion?: number
  counts: MergeCounts
  tabs: { queue: MergeQueue; count: number }[]
  commands: string[]
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
  actions?: string[]
}

export interface QueuePage {
  queue: MergeQueue
  items: MergeRowView[]
  nextCursor?: string
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
