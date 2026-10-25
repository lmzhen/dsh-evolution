/** Read-only merge wire client. Classifies every failure and never writes. */
import { ROUTES } from './routes.generated.ts'

export const HOST_ROUTES = ROUTES.merge
export type MergeQueue = 'verify' | 'pending' | 'fuse' | 'skipped'
export type StageState = 'reserved' | 'present' | 'expired' | 'lost' | 'absent'
export interface MergeCounts { verify: number; pending: number; fuse: number; skipped: number }
export interface PlatformWrite { enabled: boolean; capability: boolean }
export interface MergeApproval { mergeApproval: boolean; platformWrite?: PlatformWrite }
export interface MergeRunAction { id: string; command: string; confirm: boolean; enabled: boolean; disabledReason?: string }
export interface MergeRunView {
  id: string; state: string; command?: string; stage?: string
  progress?: { done: number; total: number } | null; startedAt: number; endedAt?: number
  failure?: { stage: string; code: string; retryable: boolean; detail?: string }
  parentRunId?: string; currentPairKey?: string; resultRef?: string; actions: MergeRunAction[]
}
export interface MergeViewPayload {
  counts: MergeCounts; expired: number; tabs: { queue: MergeQueue; count: number }[]
  commands: string[]; startCommands: { scan: string; pair: string }
  notes: string[]; degraded: boolean; latestRun?: MergeRunView; approval: MergeApproval
}
export interface RowActionView { id: string; command: string; confirm: boolean; enabled: boolean; disabledReason?: string }
export interface MergeStageView { state: StageState; expiresAt?: number }
export interface MergeSummarySlots { a: string | null; b: string | null; rationale: string | null }
export interface MergeRowView {
  id: string; pairKey: string; a: string; b: string; state: string; queue: MergeQueue; stage: string | null; label: string
  updatedAt: string; createdAt?: string; target?: string; targetActual?: string; targetCreated?: boolean
  confidence?: number; summary?: MergeSummarySlots; reason?: string; reasonCode?: string
  origin?: 'agent' | 'human' | 'system'; attempts?: number; stagingExpiresAt?: number
  expired?: 'target-taken' | 'source-changed' | 'source-gone' | 'skipped-ttl'; stageView?: MergeStageView
  failure?: { stage: string; code: string; message: string; retryable: boolean }
  verifySubState?: 'queued' | 'running' | 'failed' | 'cancelled'
  skipKind?: 'agent-keep' | 'human-reject' | 'over-limit' | 'forced'
  bodies?: { rowId?: string; name: string; side: 'live' | 'archive' }[]; actions: RowActionView[]
}
export interface QueuePage { queue: MergeQueue; items: MergeRowView[]; nextCursor?: string; counts: MergeCounts; expiredOnly: boolean }
export interface MergeBody { name: string; side: 'live' | 'archive'; text: string; markdown: boolean; truncated: boolean; totalBytes: number }
export interface MergeHistoryItem {
  name: string; kind: 'merged' | 'deleted' | 'split' | 'other'; reason: string; reasonCode?: string
  lastVersion: number; archivedAt: string; sourceRunId?: string
}
export interface MergeStateReadiness { readonly ok?: boolean; readonly code?: string; readonly message?: string; readonly steps?: readonly string[] }
export type MergeProblemKind = 'unauthenticated' | 'forbidden' | 'unmounted' | 'capability' | 'wire-version' | 'body-missing' | 'body-ambiguous' | 'bad-query' | 'refused' | 'server'
export interface MergeProblem {
  readonly kind: 'problem'; readonly code: MergeProblemKind; readonly status: number
  readonly wireCode?: string; readonly message?: string
}
export interface MergeBlocked { readonly kind: 'blocked'; readonly code: string; readonly readiness: MergeStateReadiness }
export type MergeFailure = MergeProblem | MergeBlocked
export type MergeOutcome<T> = { ok: true; payload: T } | { ok: false; failure: MergeFailure }
export const isBlocked = (failure: MergeFailure): failure is MergeBlocked => failure.kind === 'blocked'

interface WireFacts {
  readonly wireVersion: 1
  readonly counts: { readonly active: MergeCounts; readonly expired: number }
  readonly active: WireRun | null; readonly last: WireRun | null
  readonly approval: { readonly mergeApproval: boolean; readonly platformWrite?: unknown }
  readonly platformWrite?: unknown
  readonly fallback: readonly { readonly id: string; readonly command: string }[]
  readonly startCommands: { readonly scan: string; readonly pair: string }
  readonly notes: readonly string[]; readonly degraded: boolean
}
interface WireRun {
  readonly id: string; readonly state: string; readonly command?: string; readonly stage?: string
  readonly progress?: { readonly done: number; readonly total: number } | null; readonly startedAt: number
  readonly endedAt?: number; readonly failure?: { readonly stage: string; readonly code: string; readonly detail?: string; readonly retryable: boolean }
  readonly parentRunId?: string; readonly currentPairKey?: string; readonly resultRef?: string
  readonly actions?: readonly { readonly id: string; readonly command: string; readonly confirm?: boolean; readonly enabled?: boolean; readonly disabledReason?: string }[]
}
interface WireAction { readonly id: string; readonly command: string; readonly confirm: boolean; readonly enabled: boolean; readonly disabledReason?: string }
interface WireRow {
  readonly id: string; readonly state: string; readonly queue: MergeQueue; readonly a: string; readonly b: string
  readonly target?: { readonly requested: string; readonly actual?: string; readonly created?: boolean }
  readonly summary?: { readonly a: string | null; readonly b: string | null; readonly rationale: string | null }
  readonly reason?: string; readonly reasonCode?: string; readonly origin?: 'agent' | 'human' | 'system'
  readonly failure?: { readonly stage: string; readonly code: string; readonly detail?: string; readonly retryable: boolean }
  readonly staging?: string | { readonly state?: string; readonly expiresAt?: number }
  readonly stage?: string | { readonly state?: string; readonly expiresAt?: number }
  readonly expired?: { readonly kind: 'target-taken' | 'source-changed' | 'source-gone' | 'skipped-ttl' }
  readonly confidence?: number; readonly expiresAt?: number
  readonly verifySubState?: 'queued' | 'running' | 'failed' | 'cancelled'
  readonly skipKind?: 'agent-keep' | 'human-reject' | 'over-limit' | 'forced'
  readonly bodies?: readonly { readonly rowId?: string; readonly name: string; readonly side: 'live' | 'archive' }[]
  readonly attempts?: number; readonly createdAt: number; readonly updatedAt: number; readonly actions: readonly WireAction[]
}
interface WirePage { readonly wireVersion: 1; readonly queue: MergeQueue; readonly expiredOnly: boolean; readonly counts: unknown; readonly rows: readonly WireRow[]; readonly nextCursor?: string }
interface WireBody { readonly wireVersion: 1; readonly name: string; readonly side: 'live' | 'archive'; readonly text: string; readonly markdown: boolean; readonly truncated: boolean; readonly totalBytes: number }
interface WireHistory { readonly wireVersion: 1; readonly items: readonly { readonly name: string; readonly kind: 'merged' | 'deleted' | 'split' | 'other'; readonly reason: string; readonly reasonCode?: string; readonly lastVersion: number; readonly archivedAt: number; readonly sourceRunId?: string }[] }
interface WireFailureBody { readonly wireVersion?: unknown; readonly code?: unknown; readonly message?: unknown; readonly readiness?: unknown }

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
const asPlatformWrite = (value: unknown): PlatformWrite | undefined => {
  if (typeof value === 'boolean') return { enabled: value, capability: true }
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : typeof raw.value === 'boolean' ? raw.value : undefined
  const capability = typeof raw.capability === 'boolean' ? raw.capability : typeof raw.available === 'boolean' ? raw.available : true
  return enabled === undefined ? undefined : { enabled, capability }
}
const problem = (code: MergeProblemKind, status: number, wireCode?: string, message?: string): MergeProblem =>
  ({ kind: 'problem', code, status, ...(wireCode === undefined ? {} : { wireCode }), ...(message === undefined ? {} : { message }) })

async function requestWire<T>(path: string): Promise<MergeOutcome<T>> {
  let response: Response
  try { response = await fetch(path, { headers: { accept: 'application/json' } }) } catch { return { ok: false, failure: problem('server', 0) } }
  if (response.status === 401) return { ok: false, failure: problem('unauthenticated', 401) }
  if (response.status === 403) return { ok: false, failure: problem('forbidden', 403) }
  let body: unknown
  try { body = await response.json() } catch { return { ok: false, failure: problem('server', response.status) } }
  const record = body as WireFailureBody
  const code = typeof record.code === 'string' ? record.code : undefined
  const message = typeof record.message === 'string' ? record.message : undefined
  if (code === 'E-323' || message?.startsWith('E-323') === true) return { ok: false, failure: problem('capability', response.status, code, message) }
  if (response.status === 503 && code === 'merge-state-blocked' && typeof record.readiness === 'object' && record.readiness !== null) {
    return { ok: false, failure: { kind: 'blocked', code, readiness: asReadiness(record.readiness) } }
  }
  if (response.status === 404) {
    if (code === 'E-325') return { ok: false, failure: problem('unmounted', 404, code, message) }
    if (code === 'merge-body-missing' || code === 'merge-body-not-found') return { ok: false, failure: problem('body-missing', 404, code, message) }
    return { ok: false, failure: problem('unmounted', 404, code, message) }
  }
  if (response.status === 400 && code === 'merge-bad-query') return { ok: false, failure: problem('bad-query', 400, code, message) }
  if (!response.ok) return { ok: false, failure: problem('server', response.status, code, message) }
  if (record.wireVersion !== 1) return { ok: false, failure: problem('wire-version', response.status, code, message) }
  if (code === 'merge-body-missing' || code === 'merge-body-not-found') return { ok: false, failure: problem('body-missing', response.status, code, message) }
  if (code !== undefined) return { ok: false, failure: problem('refused', response.status, code, message) }
  return { ok: true, payload: body as T }
}

const toPlatformWrite = (facts: WireFacts): PlatformWrite | undefined => asPlatformWrite(facts.approval.platformWrite ?? facts.platformWrite)
const toRun = (run: WireRun): MergeRunView => ({
  id: run.id, state: run.state, ...(run.command === undefined ? {} : { command: run.command }),
  ...(run.stage === undefined ? {} : { stage: run.stage }),
  ...(run.progress === null || run.progress === undefined ? {} : { progress: { done: run.progress.done, total: run.progress.total } }),
  startedAt: run.startedAt,
  ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
  ...(run.failure === undefined ? {} : { failure: { stage: run.failure.stage, code: run.failure.code, retryable: run.failure.retryable, ...(run.failure.detail === undefined ? {} : { detail: run.failure.detail }) } }),
  ...(run.parentRunId === undefined ? {} : { parentRunId: run.parentRunId }),
  ...(run.currentPairKey === undefined ? {} : { currentPairKey: run.currentPairKey }),
  ...(run.resultRef === undefined ? {} : { resultRef: run.resultRef }),
  actions: (run.actions ?? []).map(action => ({ id: action.id, command: action.command, confirm: action.confirm === true, enabled: action.enabled !== false, ...(action.disabledReason === undefined ? {} : { disabledReason: action.disabledReason }) })),
})
const stageOf = (row: WireRow): MergeStageView | undefined => {
  const normalize = (raw: string | { readonly state?: string; readonly expiresAt?: number } | undefined): MergeStageView | undefined => {
    if (typeof raw === 'string') return raw === 'reserved' || raw === 'present' || raw === 'expired' || raw === 'lost' || raw === 'absent' ? { state: raw } : undefined
    if (raw === undefined) return undefined
    if (raw.state === 'reserved' || raw.state === 'present' || raw.state === 'expired' || raw.state === 'lost' || raw.state === 'absent') return { state: raw.state, ...(raw.expiresAt === undefined ? {} : { expiresAt: raw.expiresAt }) }
    if (raw.state === 'kept') return { state: 'present', ...(raw.expiresAt === undefined ? {} : { expiresAt: raw.expiresAt }) }
    return undefined
  }
  const stage = normalize(row.stage)
  const staging = normalize(row.staging)
  if (stage === undefined) return staging
  const expiresAt = stage.expiresAt ?? (staging?.state === stage.state ? staging.expiresAt : undefined)
  return expiresAt === undefined ? stage : { ...stage, expiresAt }
}
const toRow = (row: WireRow): MergeRowView => ({
  id: row.id, pairKey: row.id, a: row.a, b: row.b, state: row.state, queue: row.queue, stage: null, label: row.a + ' + ' + row.b,
  updatedAt: new Date(row.updatedAt).toISOString(), createdAt: new Date(row.createdAt).toISOString(),
  ...(row.target === undefined ? {} : { target: row.target.requested, ...(row.target.actual === undefined ? {} : { targetActual: row.target.actual }), ...(row.target.created === undefined ? {} : { targetCreated: row.target.created }) }),
  ...(row.confidence === undefined ? {} : { confidence: row.confidence }),
  ...(row.summary === undefined ? {} : { summary: { a: row.summary.a, b: row.summary.b, rationale: row.summary.rationale } }),
  ...(row.reason === undefined ? {} : { reason: row.reason }),
  ...(row.reasonCode === undefined ? {} : { reasonCode: row.reasonCode }),
  ...(row.origin === undefined ? {} : { origin: row.origin }),
  ...(row.attempts === undefined ? {} : { attempts: row.attempts }),
  ...(row.expiresAt === undefined ? {} : { stagingExpiresAt: row.expiresAt }),
  ...(row.expired === undefined ? {} : { expired: row.expired.kind }),
  ...(stageOf(row) === undefined ? {} : { stageView: stageOf(row)! }),
  ...(row.failure === undefined ? {} : { failure: { stage: row.failure.stage, code: row.failure.code, message: row.failure.detail ?? row.failure.code, retryable: row.failure.retryable } }),
  ...(row.verifySubState === undefined ? {} : { verifySubState: row.verifySubState }),
  ...(row.skipKind === undefined ? {} : { skipKind: row.skipKind }),
  ...(row.bodies === undefined ? {} : { bodies: row.bodies.map(body => ({ ...(body.rowId === undefined ? {} : { rowId: body.rowId }), name: body.name, side: body.side })) }),
  actions: row.actions.map(action => ({ id: action.id, command: action.command, confirm: action.confirm, enabled: action.enabled, ...(action.disabledReason === undefined ? {} : { disabledReason: action.disabledReason }) })),
})

export async function view(): Promise<MergeOutcome<MergeViewPayload>> {
  const answer = await requestWire<WireFacts>(HOST_ROUTES.view)
  if (!answer.ok) return answer
  const facts = answer.payload
  const platformWrite = toPlatformWrite(facts)
  return { ok: true, payload: {
    counts: facts.counts.active,
    expired: facts.counts.expired,
    tabs: (['verify', 'pending', 'fuse', 'skipped'] as const).map(queue => ({ queue, count: facts.counts.active[queue] })),
    commands: facts.fallback.map(item => item.command),
    startCommands: facts.startCommands,
    notes: [...facts.notes],
    degraded: facts.degraded,
    ...(facts.last === null && facts.active === null ? {} : { latestRun: toRun(facts.last ?? facts.active!) }),
    approval: { mergeApproval: facts.approval.mergeApproval, ...(platformWrite === undefined ? {} : { platformWrite }) },
  } }
}

export async function rows(queue: MergeQueue, cursor?: string, expiredOnly = false): Promise<MergeOutcome<QueuePage>> {
  const url = HOST_ROUTES.rows + '?queue=' + encodeURIComponent(queue) + (cursor === undefined ? '' : '&cursor=' + encodeURIComponent(cursor)) + (expiredOnly ? '&expired=1' : '')
  const answer = await requestWire<WirePage>(url)
  if (!answer.ok) return answer
  if (answer.payload.queue !== queue || answer.payload.expiredOnly !== expiredOnly) return { ok: false, failure: problem('server', 200) }
  return { ok: true, payload: { queue: answer.payload.queue, expiredOnly: answer.payload.expiredOnly, items: answer.payload.rows.map(toRow), counts: answer.payload.counts as MergeCounts, ...(answer.payload.nextCursor === undefined ? {} : { nextCursor: answer.payload.nextCursor }) } }
}

export async function body(name: string, side: 'live' | 'archive', rowId?: string): Promise<MergeOutcome<MergeBody>> {
  const url = HOST_ROUTES.body + (rowId === undefined ? '?name=' + encodeURIComponent(name) : '?id=' + encodeURIComponent(rowId)) + '&side=' + side
  const answer = await requestWire<WireBody>(url)
  if (!answer.ok) {
    if (answer.failure.kind === 'problem' && answer.failure.code === 'bad-query' && (answer.failure.message ?? '').includes('multiple merge rows')) {
      return { ok: false, failure: { ...answer.failure, code: 'body-ambiguous' } }
    }
    return answer
  }
  return { ok: true, payload: { name: answer.payload.name, side: answer.payload.side, text: answer.payload.text, markdown: answer.payload.markdown, truncated: answer.payload.truncated, totalBytes: answer.payload.totalBytes } }
}

export async function history(): Promise<MergeOutcome<{ items: MergeHistoryItem[] }>> {
  const answer = await requestWire<WireHistory>(HOST_ROUTES.history)
  return answer.ok
    ? { ok: true, payload: { items: answer.payload.items.map(item => ({ name: item.name, kind: item.kind, reason: item.reason, ...(item.reasonCode === undefined ? {} : { reasonCode: item.reasonCode }), lastVersion: item.lastVersion, archivedAt: new Date(item.archivedAt).toISOString(), ...(item.sourceRunId === undefined ? {} : { sourceRunId: item.sourceRunId }) })) } }
    : answer
}
