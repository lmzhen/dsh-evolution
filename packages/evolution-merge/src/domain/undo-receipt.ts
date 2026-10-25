/** Undo receipt: immutable per-pair settlement, separate from the commit receipt. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
export interface UndoReceipt {
  readonly version: 1
  readonly runId: string
  readonly parentRunId?: string
  readonly pairKey: string
  readonly unitId: string
  readonly evidenceSha256: string
  readonly target: string
  readonly sources: readonly string[]
  readonly restoredTargetHash: string | null
  readonly restoredSourceHashes: Readonly<Record<string, string>>
  readonly at: number
}
export function undoReceiptPath(home: string, runId: string, pairKey: string): string {
  return join(home, 'merge', 'undo-receipts', encodeURIComponent(runId), createHash('sha256').update(pairKey).digest('hex') + '.json')
}
export async function readUndoReceipt(io: EvolutionIoLike, home: string, runId: string, pairKey: string): Promise<UndoReceipt | null> {
  const raw = await io.readText(undoReceiptPath(home, runId, pairKey)).catch(() => null)
  if (raw === null) return null
  try { return JSON.parse(raw) as UndoReceipt } catch { return null }
}
export async function writeUndoReceipt(io: EvolutionIoLike, home: string, receipt: UndoReceipt): Promise<void> {
  await io.writeText(undoReceiptPath(home, receipt.runId, receipt.pairKey), JSON.stringify(receipt, null, 2) + '\n')
}
