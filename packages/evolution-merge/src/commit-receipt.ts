/**
 * Commit receipt: <run>/commit.json, written immediately after a successful commit.
 * It is the idempotency/recovery marker — merge resume and run start read it before
 * replaying a commit. Receipt write failure must not turn a landed commit into a failure;
 * the caller reports the warning instead.
 */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { stagingRoot } from './staging.ts'

export interface CommitReceipt {
  readonly runId: string
  readonly unitId: string
  readonly target: string
  readonly create: boolean
  readonly sources: readonly string[]
  readonly archived: readonly string[]
  readonly at: number
}

export function commitReceiptPath(home: string, runId: string): string {
  return join(stagingRoot(home, runId), 'commit.json')
}

export async function writeCommitReceipt(io: EvolutionIoLike, home: string, receipt: CommitReceipt): Promise<string> {
  const path = commitReceiptPath(home, receipt.runId)
  await io.writeText(path, JSON.stringify(receipt, null, 2) + '\n')
  return path
}

export async function readCommitReceipt(io: EvolutionIoLike, home: string, runId: string): Promise<CommitReceipt | null> {
  const raw = await io.readText(commitReceiptPath(home, runId))
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CommitReceipt>
    if (typeof parsed.runId !== 'string' || typeof parsed.unitId !== 'string' || typeof parsed.target !== 'string'
      || typeof parsed.create !== 'boolean' || !Array.isArray(parsed.sources) || !Array.isArray(parsed.archived) || typeof parsed.at !== 'number') {
      return null
    }
    return parsed as CommitReceipt
  } catch {
    return null
  }
}
