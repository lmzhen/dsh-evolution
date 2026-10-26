/**
 * Commit receipt: <run>/commit.json, written immediately after a successful commit.
 * It is the idempotency/recovery marker — merge resume and run start read it before
 * replaying a commit. Receipt write failure must not turn a landed commit into a failure;
 * the caller reports the warning instead.
 */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { stagingRoot } from './staging.ts'
import type { MergeValidationPlanRef } from './contracts.ts'

export interface CommitReceipt {
  readonly runId: string
  readonly parentRunId?: string
  readonly unitId: string
  readonly evidenceSha256?: string
  readonly validationPlan?: MergeValidationPlanRef
  readonly target: string
  readonly create: boolean
  readonly sources: readonly string[]
  readonly pairKey?: string
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
  const leaf = stageKey.split('/').pop() ?? stageKey
  return join(durableReceiptDir(home, parentRunId), leaf + '.json')
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
  // One durable file per unit: two pairs of the same run/target must not overwrite each other.
  const leaf = (receipt.runId + '-' + receipt.unitId).replace(/[^A-Za-z0-9._-]+/g, '-')
  await io.writeText(durableReceiptPath(home, parent, leaf), JSON.stringify({ ...receipt, parentRunId: parent }, null, 2) + '\n')
  return path
}

export async function readCommitReceipts(io: EvolutionIoLike, home: string): Promise<readonly CommitReceipt[]> {
  const root = join(home, 'merge', 'receipts')
  const out: CommitReceipt[] = []
  let runs: string[]
  try { runs = await io.list(root) } catch { return out }
  for (const run of runs.sort()) {
    const dir = join(root, run)
    let files: string[]
    try { files = await io.list(dir) } catch { continue }
    for (const file of files.sort()) {
      if (!file.endsWith('.json')) continue
      const receipt = parseReceipt(await io.readText(join(dir, file)))
      if (receipt !== null) out.push(receipt)
    }
  }
  return out
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
