/** G5-2 Facts pure projection. Reads a snapshot; never writes. */
import type { EvolutionIoLike, RunRecord } from '@deepseek-ai/dsh-evolution-core'
import type { MergeRow, MergeQueue } from './contracts.ts'
import { loadMergeState } from './state.ts'
import { MERGE_COMMAND_SURFACE } from './command-surface.ts'
import type { Facts, MergeCounts, RunView, WireRunState } from './wire.ts'

const queueOf = (row: MergeRow): MergeQueue => row.state === 'approved' ? 'fuse' : row.queue
const isExpired = (row: MergeRow): boolean => row.expired !== undefined

export function countsOf(rows: readonly MergeRow[]): MergeCounts {
  const active = { verify: 0, pending: 0, fuse: 0, skipped: 0 }
  let expired = 0
  for (const row of rows) {
    if (isExpired(row)) { expired += 1; continue }
    active[queueOf(row)] += 1
  }
  return { active, expired }
}

export function toRunView(record: RunRecord, readAt: number): RunView {
  const state = (record.mergeStatus ?? record.state) as WireRunState
  return {
    wireVersion: 1,
    readAt,
    id: record.id,
    state,
    command: record.command ?? 'scan',
    ...(record.stage === undefined ? {} : { stage: record.stage as NonNullable<RunView['stage']> }),
    progress: record.progress === undefined ? null : { done: record.progress.done, total: record.progress.total },
    startedAt: record.startedAt,
    ...(record.endedAt === undefined ? {} : { endedAt: record.endedAt }),
    ...(record.failure === undefined ? {} : { failure: { stage: 'settle', code: 'run-failed', retryable: false, retryFrom: 'none', detail: record.failure } }),
    ...(record.parentRunId === undefined ? {} : { parentRunId: record.parentRunId }),
    ...(record.pairKey === undefined ? {} : { currentPairKey: record.pairKey }),
    actions: [
      { id: 'status', command: '/evolution merge status ' + record.id, confirm: false, enabled: true },
      { id: 'report', command: '/evolution merge report ' + record.id, confirm: false, enabled: record.resultRef !== undefined },
      { id: 'cancel', command: '/evolution merge cancel ' + record.id, confirm: false, enabled: state === 'running' },
    ],
  }
}

export interface FactsInput {
  readonly rows: readonly MergeRow[]
  readonly runs: readonly RunRecord[]
  readonly approval: boolean
  readonly readAt: number
  readonly notes?: readonly string[]
}

export interface ReadFactsOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly runs: readonly RunRecord[]
  readonly approval: boolean
  readonly readAt: number
}

/** GET projection: reads state + runs; never writes. */
export async function readFacts(options: ReadFactsOptions): Promise<Facts> {
  const loaded = await loadMergeState(options.io, options.home)
  return buildFacts({
    rows: loaded.state.rows,
    runs: options.runs,
    approval: options.approval,
    readAt: options.readAt,
    notes: loaded.ok ? [] : [loaded.note ?? 'state-unreadable'],
  })
}

export function buildFacts(input: FactsInput): Facts {
  const ordered = [...input.runs].sort((a, b) => b.startedAt - a.startedAt)
  const active = ordered.find(run => (run.mergeStatus ?? run.state) === 'running')
  const last = ordered.find(run => (run.mergeStatus ?? run.state) !== 'running')
  const notes = input.notes ?? []
  return {
    wireVersion: 1,
    readAt: input.readAt,
    approval: { mergeApproval: input.approval },
    counts: countsOf(input.rows),
    active: active === undefined ? null : toRunView(active, input.readAt),
    last: last === undefined ? null : toRunView(last, input.readAt),
    startCommands: { scan: '/evolution merge scan', pair: '/evolution merge pair <a> <b>' },
    fallback: MERGE_COMMAND_SURFACE.fallback,
    notes,
    degraded: notes.length > 0,
  }
}
