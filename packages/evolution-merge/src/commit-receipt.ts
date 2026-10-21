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
  readonly parentRunId?: string
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

export function durableReceiptDir(home: string, parentRunId: string): string {
  return join(home, 'merge', 'receipts', parentRunId)
}

export function durableReceiptPath(home: string, parentRunId: string, stageKey: string): string {
  return join(durableReceiptDir(home, parentRunId), stageKey.split('/').pop() + '.json')
}

function parseReceipt(raw: string | null): CommitReceipt | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CommitReceipt>
    if (typeof parsed.runId !== 'string' || typeof parsed.unitId !== 'string' || typeof parsed.target !== 'string'
      || typeof parsed.create !== 'boolean' || !Array.isArray(parsed.sources) || !Array.isArray(parsed.archived) || typeof parsed.at !== 'number') {
      return null
    }
    return parsed as CommitReceipt
  } catch { return null }
}

export async function writeCommitReceipt(io: EvolutionIoLike, home: string, receipt: CommitReceipt): Promise<string> {
  const path = commitReceiptPath(home, receipt.runId)
  await io.writeText(path, JSON.stringify(receipt, null, 2) + '\n')
  const parent = receipt.parentRunId ?? receipt.runId.split('/pairs/')[0] ?? receipt.runId
  await io.writeText(durableReceiptPath(home, parent, receipt.runId), JSON.stringify({ ...receipt, parentRunId: parent }, null, 2) + '\n')
  return path
}

export async function readCommitReceipt(io: EvolutionIoLike, home: string, runId: string, target?: string): Promise<CommitReceipt | null> {
  const direct = parseReceipt(await io.readText(commitReceiptPath(home, runId)))
  if (direct !== null && (target === undefined || direct.target === target)) return direct
  try {
    const names = await io.list(durableReceiptDir(home, runId))
    for (const name of names.sort()) {
      const receipt = parseReceipt(await io.readText(join(durableReceiptDir(home, runId), name)))
      if (receipt !== null && (target === undefined || receipt.target === target)) return receipt
    }
  } catch { /* absent */ }
  return null
}
