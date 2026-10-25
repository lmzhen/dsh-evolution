import { readTextOrNull, listOrEmpty } from './read-probe.ts'
/** 1b-1 additive types for the merge run lifecycle; no writer is active in this phase. */
import { join } from 'node:path'
import { transactIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

export type MergeRunPhase = 'begin' | 'running' | 'awaiting-approval' | 'settled' | 'cancelled' | 'undone'
export interface MergeRunMeta {
  readonly version: 1
  readonly runId: string
  readonly pairCount?: number
  /** The pair a single-pair command (pair/approve/resume) is working on; absent for scan. */
  readonly pairKey?: string
  readonly parentRunId?: string
  readonly phase: MergeRunPhase
  readonly stopReason?: string
  readonly approval?: 'pending' | 'approved' | 'rejected'
  readonly reportRef?: string
  readonly undonePairs?: readonly string[]
  readonly undoneAt?: string
  readonly degraded?: boolean
  readonly createdAt: string
  readonly updatedAt: string
}
export interface PairIndexEntry {
  readonly version: 1
  readonly runId: string
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly target: string
  readonly targetRevision?: string
  readonly sourceRevisions?: Readonly<Record<string, string>>
  readonly state: 'pending' | 'approved' | 'fused' | 'skipped'
  readonly updatedAt: string
}
export interface RunCoordinatorRead {
  readonly runId: string
  readonly meta: MergeRunMeta | null
  readonly pairs: readonly PairIndexEntry[]
  readonly consistency: 'eventual'
}
export interface RunCoordinator {
  begin(meta: MergeRunMeta): Promise<void>
  recordPair(entry: PairIndexEntry): Promise<void>
  read(runId: string): Promise<RunCoordinatorRead>
}

export function runMetaPath(home: string, runId: string): string { return join(home, 'merge', 'run-meta', encodeURIComponent(runId) + '.json') }
export async function writeRunMeta(io: EvolutionIoLike, home: string, meta: MergeRunMeta): Promise<void> {
  await transactIo(io, runMetaPath(home, meta.runId), () => JSON.stringify(meta, null, 2) + '\n')
}
export async function readRunMeta(io: EvolutionIoLike, home: string, runId: string): Promise<MergeRunMeta | null> {
  const raw = await readTextOrNull(io, runMetaPath(home, runId))
  if (raw === null) return null
  try { return JSON.parse(raw) as MergeRunMeta } catch { return null }
}

/** Every run-meta record on disk (the in-flight index for pair/target serialisation). */
export async function readRunMetas(io: EvolutionIoLike, home: string): Promise<readonly MergeRunMeta[]> {
  const root = join(home, 'merge', 'run-meta')
  const names = await io.exists(root) ? await listOrEmpty(io, root) : []
  const metas: MergeRunMeta[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const raw = await readTextOrNull(io, join(root, name))
    if (raw === null) continue
    try {
      const meta = JSON.parse(raw) as MergeRunMeta
      if (typeof meta.runId === 'string' && typeof meta.phase === 'string') metas.push(meta)
    } catch { /* malformed meta is not an in-flight claim */ }
  }
  return metas
}

/** The run currently working on this pair, if any (pairKey is written at run begin). */
export function inFlightPairRun(metas: readonly MergeRunMeta[], pairKeyValue: string): MergeRunMeta | undefined {
  return metas.find(meta => meta.phase === 'running' && meta.pairKey === pairKeyValue)
}

export { recordPair } from './pair-index-store.ts'
