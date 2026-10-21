/**
 * Read-only view models for the four merge routes. Pure functions; the host loads rows and
 * runs, the client renders these shapes. No io, no write paths.
 */
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import type { MergeQueue, MergeRow } from './contracts.ts'
import { queueOf, stageOf } from './contracts.ts'
import { countRows, type MergeCounts } from './status.ts'

export interface MergeRowView {
  readonly id: string
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly state: MergeRow['state']
  readonly queue: MergeQueue
  readonly stage: string | null
  readonly label: string
  readonly updatedAt: string
  readonly createdAt: string
  readonly target?: string
  readonly confidence?: number
  readonly failure?: { readonly stage: string; readonly code: string; readonly message: string; readonly retryable: boolean }
  readonly attempts?: number
  readonly origin?: 'agent' | 'human'
  readonly stagingExpiresAt?: number
  readonly actions: readonly string[]
}

export function toRowView(row: MergeRow): MergeRowView {
  return {
    id: row.id,
    pairKey: row.pairKey,
    a: row.a,
    b: row.b,
    state: row.state,
    queue: queueOf(row.state),
    stage: stageOf(row.state),
    label: row.a + ' + ' + row.b,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    ...(row.decision?.target === undefined ? {} : { target: row.decision.target }),
    ...(row.decision?.confidence === undefined ? {} : { confidence: row.decision.confidence }),
    ...(row.failure === undefined ? {} : { failure: { stage: row.failure.stage, code: row.failure.code, message: row.failure.message, retryable: row.failure.retryable } }),
    ...(row.attempts === undefined ? {} : { attempts: row.attempts }),
    ...(row.origin === undefined ? {} : { origin: row.origin }),
    ...(row.stagingExpiresAt === undefined ? {} : { stagingExpiresAt: row.stagingExpiresAt }),
    actions: row.state === 'pending'
      ? ['/evolution merge approve ' + row.id, '/evolution merge reject ' + row.id]
      : row.state === 'skipped'
        ? ['/evolution merge skipped --restore ' + row.id]
        : ['/evolution merge resume ' + row.id],
  }
}

export interface MergeView {
  readonly schemaVersion: 1
  readonly counts: MergeCounts
  readonly tabs: readonly { readonly queue: MergeQueue; readonly count: number }[]
  readonly commands: readonly string[]
  readonly latestRun?: MergeRunFact
}

export function buildMergeView(rows: readonly MergeRow[], commands: readonly string[], latestRun?: MergeRunFact): MergeView {
  const counts = countRows(rows)
  return {
    schemaVersion: 1,
    counts,
    tabs: [
      { queue: 'pending', count: counts.pending },
      { queue: 'retry', count: counts.retry },
      { queue: 'skipped', count: counts.skipped },
    ],
    commands,
    ...(latestRun === undefined ? {} : { latestRun }),
  }
}

export interface QueuePage {
  readonly queue: MergeQueue
  readonly items: readonly MergeRowView[]
  readonly nextCursor?: string
}

export function pageQueue(rows: readonly MergeRow[], queue: MergeQueue, cursor = 0, limit = 50): QueuePage {
  const filtered = rows.filter(row => queueOf(row.state) === queue)
  const size = Math.max(1, Math.min(200, limit))
  const start = Math.max(0, cursor)
  const items = filtered.slice(start, start + size).map(toRowView)
  const next = start + size < filtered.length ? String(start + size) : undefined
  return { queue, items, ...(next === undefined ? {} : { nextCursor: next }) }
}

export interface MergeRunFact {
  readonly id: string
  readonly state: RunRecord['state']
  readonly command?: RunRecord['command']
  readonly stage?: RunRecord['stage']
  readonly progress?: RunRecord['progress']
  readonly startedAt: number
  readonly endedAt?: number
  readonly resultRef?: string
  readonly failure?: string
  readonly supersededAt?: number
}

export function toRunFact(run: RunRecord): MergeRunFact {
  return {
    id: run.id,
    state: run.state,
    ...(run.command === undefined ? {} : { command: run.command }),
    ...(run.stage === undefined ? {} : { stage: run.stage }),
    ...(run.progress === undefined ? {} : { progress: run.progress }),
    startedAt: run.startedAt,
    ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
    ...(run.resultRef === undefined ? {} : { resultRef: run.resultRef }),
    ...(run.failure === undefined ? {} : { failure: run.failure }),
    ...(run.supersededAt === undefined ? {} : { supersededAt: run.supersededAt }),
  }
}
