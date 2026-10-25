/**
 * The two read routes this panel uses. Parses the frozen wireVersion=1 envelopes
 * and maps them to the panel view types; the panel never sees a path or a raw host body.
 */
import { ROUTES } from './routes.generated.ts'
import type { RouteFailure } from './route-client.generated.ts'

export const HOST_ROUTES = ROUTES.merge

export type MergeQueue = 'verify' | 'pending' | 'fuse' | 'skipped'

export interface MergeCounts { verify: number; pending: number; fuse: number; skipped: number }
export interface MergeRunView { id: string; state: string; command?: string; stage?: string; progress?: { done: number; total: number }; startedAt: number }
export interface MergeViewPayload { counts: MergeCounts; expired: number; tabs: { queue: MergeQueue; count: number }[]; commands: string[]; startCommands: { scan: string; pair: string }; notes: string[]; degraded: boolean; latestRun?: MergeRunView; approval?: boolean }
export interface RowActionView { id: string; command: string; confirm: boolean; enabled: boolean; disabledReason?: string }
export interface MergeRowView {
  id: string; pairKey: string; a: string; b: string; state: string; queue: MergeQueue; stage: string | null; label: string
  updatedAt: string; createdAt?: string; target?: string; confidence?: number; aSummary?: string; bSummary?: string; rationale?: string
  failure?: { stage: string; code: string; message: string; retryable: boolean }
  attempts?: number; origin?: 'agent' | 'human'; stagingExpiresAt?: number; expired?: 'target-taken' | 'source-changed' | 'skipped-ttl'
  reason?: string; summary?: string[]; actions: RowActionView[]
  targetActual?: string; targetCreated?: boolean; stagingState?: 'none' | 'kept' | 'cleared-source-ok' | 'cleared-source-gone'
  verifySubState?: 'queued' | 'running' | 'failed' | 'cancelled'; skipKind?: 'agent-keep' | 'human-reject' | 'over-limit' | 'forced'
  bodies?: { name: string; side: 'live' | 'archive' }[]
}
export interface QueuePage { queue: MergeQueue; items: MergeRowView[]; nextCursor?: string }
export interface MergeBody { content: string; markdown: boolean; html: string }
export interface MergeHistoryItem { name: string; kind: 'merged' | 'deleted' | 'split' | 'other'; reason: string; lastVersion: number; archivedAt: string; sourceRunId?: string }
export interface MergeStateReadiness {
  readonly ok?: boolean
  readonly code?: string
  readonly message?: string
  readonly steps?: readonly string[]
}
export interface MergeBlocked {
  readonly kind: 'blocked'
  readonly code: string
  readonly readiness: MergeStateReadiness
}
export type MergeFailure = RouteFailure | MergeBlocked
export type MergeOutcome<T> = { ok: true; payload: T } | { ok: false; failure: MergeFailure }

interface WireFacts {
  readonly wireVersion: 1
  readonly counts: { readonly active: MergeCounts; readonly expired: number }
  readonly active: WireRun | null
  readonly last: WireRun | null
  readonly approval: { readonly mergeApproval: boolean }
  readonly fallback: readonly { readonly id: string; readonly command: string }[]
  readonly startCommands: { readonly scan: string; readonly pair: string }
  readonly notes: readonly string[]
  readonly degraded: boolean
}
interface WireRun { readonly id: string; readonly state: string; readonly command?: string; readonly stage?: string; readonly progress?: { readonly done: number; readonly total: number } | null; readonly startedAt: number }
interface WireAction { readonly id: string; readonly command: string; readonly confirm: boolean; readonly enabled: boolean; readonly disabledReason?: string }
interface WireRow {
  readonly id: string; readonly state: string; readonly queue: MergeQueue; readonly a: string; readonly b: string
  readonly target?: { readonly requested: string; readonly actual?: string; readonly created?: boolean }; readonly summary?: { readonly a: string | null; readonly b: string | null; readonly rationale: string | null }
  readonly reason?: string; readonly origin?: 'agent' | 'human' | 'system'; readonly failure?: { readonly stage: string; readonly code: string; readonly detail?: string; readonly retryable: boolean }
  readonly staging?: { readonly state?: string; readonly expiresAt?: number }; readonly expired?: { readonly kind: 'target-taken' | 'source-changed' | 'skipped-ttl' }
  readonly confidence?: number; readonly expiresAt?: number
  readonly verifySubState?: 'queued' | 'running' | 'failed' | 'cancelled'; readonly skipKind?: 'agent-keep' | 'human-reject' | 'over-limit' | 'forced'
  readonly bodies?: readonly { readonly name: string; readonly side: 'live' | 'archive' }[]
  readonly attempts?: number; readonly createdAt: number; readonly updatedAt: number; readonly actions: readonly WireAction[]
}
interface WirePage { readonly wireVersion: 1; readonly queue: MergeQueue; readonly expiredOnly: boolean; readonly counts: unknown; readonly rows: readonly WireRow[]; readonly nextCursor?: string; readonly notes?: readonly string[] }
interface WireBody { readonly wireVersion: 1; readonly text: string; readonly markdown: boolean }
interface WireHistory { readonly wireVersion: 1; readonly items: readonly { readonly name: string; readonly kind: 'merged' | 'deleted' | 'split' | 'other'; readonly reason: string; readonly lastVersion: number; readonly archivedAt: number; readonly sourceRunId?: string }[] }

const asReadiness = (value: unknown): MergeStateReadiness => {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const steps = Array.isArray(raw.steps) ? raw.steps.filter((step): step is string => typeof step === 'string') : undefined
  return {
    ...(typeof raw.ok === 'boolean' ? { ok: raw.ok } : {}),
    ...(typeof raw.code === 'string' ? { code: raw.code } : {}),
    ...(typeof raw.message === 'string' ? { message: raw.message } : {}),
    ...(steps === undefined ? {} : { steps }),
  }
}

const blockedFailure = (record: { code?: unknown; readiness?: unknown }): MergeBlocked | undefined => {
  if (typeof record.code !== 'string' || !record.code.startsWith('merge-state-')) return undefined
  if (typeof record.readiness !== 'object' || record.readiness === null) return undefined
  return { kind: 'blocked', code: record.code, readiness: asReadiness(record.readiness) }
}

async function requestWire<T>(path: string): Promise<MergeOutcome<T>> {
  let response: Response
  try { response = await fetch(path, { headers: { accept: 'application/json' } }) } catch { return { ok: false, failure: { kind: 'server', status: 0 } } }
  if (response.status === 401) return { ok: false, failure: { kind: 'unauthenticated', status: 401 } }
  if (response.status === 403) return { ok: false, failure: { kind: 'forbidden', status: 403 } }
  if (response.status === 404) return { ok: false, failure: { kind: 'unmounted', status: 404 } }
  let body: unknown
  try { body = await response.json() } catch { return { ok: false, failure: { kind: 'server', status: response.status } } }
  const record = body as { wireVersion?: unknown; code?: unknown; message?: unknown; readiness?: unknown }
  const blocked = blockedFailure(record)
  if (blocked !== undefined) return { ok: false, failure: blocked }
  if (!response.ok) return { ok: false, failure: { kind: 'server', status: response.status } }
  if (record.wireVersion !== 1) return { ok: false, failure: { kind: 'server', status: response.status } }
  if (typeof record.code === 'string') return { ok: false, failure: { kind: 'refused', code: record.code, message: typeof record.message === 'string' ? record.message : record.code } }
  return { ok: true, payload: body as T }
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const toRun = (run: WireRun): MergeRunView => ({ id: run.id, state: run.state, ...(run.command === undefined ? {} : { command: run.command }), ...(run.stage === undefined ? {} : { stage: run.stage }), ...(run.progress === null || run.progress === undefined ? {} : { progress: { done: run.progress.done, total: run.progress.total } }), startedAt: run.startedAt })
const toRow = (row: WireRow): MergeRowView => ({
  id: row.id, pairKey: row.id, a: row.a, b: row.b, state: row.state, queue: row.queue, stage: null, label: row.a + ' + ' + row.b,
  updatedAt: new Date(row.updatedAt).toISOString(), createdAt: new Date(row.createdAt).toISOString(),
  ...(row.target === undefined ? {} : { target: row.target.requested, ...(row.target.actual === undefined ? {} : { targetActual: row.target.actual }), ...(row.target.created === undefined ? {} : { targetCreated: row.target.created }) }),
  ...(row.staging?.state === undefined ? {} : { stagingState: row.staging.state as NonNullable<MergeRowView['stagingState']> }),
  ...(row.verifySubState === undefined ? {} : { verifySubState: row.verifySubState }),
  ...(row.skipKind === undefined ? {} : { skipKind: row.skipKind }),
  ...(row.bodies === undefined ? {} : { bodies: row.bodies.map(body => ({ name: body.name, side: body.side })) }),
  ...(row.confidence === undefined ? {} : { confidence: row.confidence }),
  ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
  ...(row.summary === undefined ? {} : { summary: [row.summary.a, row.summary.b, row.summary.rationale].filter((value): value is string => value !== null) }),
  ...(row.reason === undefined ? {} : { reason: row.reason }),
  ...(row.origin === undefined ? {} : { origin: row.origin === 'system' ? 'agent' : row.origin }),
  ...(row.failure === undefined ? {} : { failure: { stage: row.failure.stage, code: row.failure.code, message: row.failure.detail ?? row.failure.code, retryable: row.failure.retryable } }),
  ...(row.staging?.expiresAt === undefined ? {} : { stagingExpiresAt: row.staging.expiresAt }),
  ...(row.expired === undefined ? {} : { expired: row.expired.kind }),
  ...(row.attempts === undefined ? {} : { attempts: row.attempts }),
  actions: row.actions.map(action => ({ id: action.id, command: action.command, confirm: action.confirm, enabled: action.enabled, ...(action.disabledReason === undefined ? {} : { disabledReason: action.disabledReason }) })),
})

export async function view(): Promise<MergeOutcome<MergeViewPayload>> {
  const answer = await requestWire<WireFacts>(HOST_ROUTES.view)
  if (!answer.ok) return answer
  const facts = answer.payload
  return { ok: true, payload: {
    counts: facts.counts.active,
    expired: facts.counts.expired,
    tabs: (['verify', 'pending', 'fuse', 'skipped'] as const).map(queue => ({ queue, count: facts.counts.active[queue] })),
    commands: facts.fallback.map(item => item.command),
    startCommands: facts.startCommands,
    notes: [...facts.notes],
    degraded: facts.degraded,
    ...(facts.last === null && facts.active === null ? {} : { latestRun: toRun(facts.last ?? facts.active!) }),
    approval: facts.approval.mergeApproval,
  } }
}

export async function rows(queue: MergeQueue, cursor?: string, expiredOnly = false): Promise<MergeOutcome<QueuePage>> {
  const url = HOST_ROUTES.rows + '?queue=' + encodeURIComponent(queue) + (cursor === undefined ? '' : '&cursor=' + encodeURIComponent(cursor)) + (expiredOnly ? '&expired=1' : '')
  const answer = await requestWire<WirePage>(url)
  if (!answer.ok) return answer
  if (answer.payload.queue !== queue || answer.payload.expiredOnly !== expiredOnly) return { ok: false, failure: { kind: 'server', status: 200 } }
  return { ok: true, payload: { queue: answer.payload.queue, items: answer.payload.rows.map(toRow), ...(answer.payload.nextCursor === undefined ? {} : { nextCursor: answer.payload.nextCursor }) } }
}

export async function body(id: string, side: 'a' | 'b'): Promise<MergeOutcome<MergeBody>> {
  const url = HOST_ROUTES.body + '?id=' + encodeURIComponent(id) + '&side=' + side
  const answer = await requestWire<WireBody>(url)
  return answer.ok ? { ok: true, payload: { content: answer.payload.text, markdown: answer.payload.markdown, html: escapeHtml(answer.payload.text) } } : answer
}

export async function history(): Promise<MergeOutcome<{ items: MergeHistoryItem[] }>> {
  const answer = await requestWire<WireHistory>(HOST_ROUTES.history)
  return answer.ok ? { ok: true, payload: { items: answer.payload.items.map(item => ({ name: item.name, kind: item.kind, reason: item.reason, lastVersion: item.lastVersion, archivedAt: new Date(item.archivedAt).toISOString(), ...(item.sourceRunId === undefined ? {} : { sourceRunId: item.sourceRunId }) })) } } : answer
}
