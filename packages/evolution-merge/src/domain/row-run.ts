import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { pairLedger } from './pair-ledger.ts'

/** Attach the in-flight child run to a row before its round2 starts (P1-8). */
export async function attachRunToRow(io: EvolutionIoLike, home: string, rowId: string, runId: string): Promise<void> {
  const attached = await pairLedger(io, home).transact(tx => {
    const current = tx.rows().find(row => row.id === rowId)
    if (current === undefined) return false
    const moved = tx.transition(rowId, { type: 'run-attached', runId }, current.version)
    return moved.ok
  })
  if (!attached) throw new Error('row is not attachable to run: ' + rowId)
}
