import { LeaseStore, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { pairLedger } from './pair-ledger.ts'

/** Attach the in-flight child run to a row before its round2 starts (P1-8). */
export async function attachRunToRow(io: EvolutionIoLike, home: string, rowId: string, runId: string, isActive?: (id: string) => boolean | Promise<boolean>, fence?: { run<T>(body: () => Promise<T>): Promise<T> }): Promise<void> {
  const leaseStore = new LeaseStore({ io, home, ttlMs: 30_000 })
  const lease = await leaseStore.acquire('foreground', 'row-attach:' + rowId)
  if (!lease.ok) throw new Error('row attach is busy: ' + rowId)
  try {
  const attached = await pairLedger(io, home, fence).transact(async tx => {
    const current = tx.rows().find(row => row.id === rowId)
    if (current === undefined) return false
    if (current.runId !== undefined && current.runId !== runId && (await isActive?.(current.runId)) === true) return false
    const moved = tx.transition(rowId, { type: 'run-attached', runId }, current.version)
    return moved.ok
  })
  if (!attached) throw new Error('row is not attachable to run: ' + rowId)
  } finally { await leaseStore.release(lease.token) }
}
