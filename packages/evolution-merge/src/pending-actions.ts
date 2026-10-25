/**
 * Pending approval actions. The row lookup and transition happen in one PairLedger transaction,
 * so two clients approving the same row cannot both win.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { MergeRow } from './contracts.ts'
import { v4ToLegacy } from './domain/row-v4.ts'
import { pairLedger } from './domain/pair-ledger.ts'

export type PendingActionResult =
  | { readonly ok: true; readonly row: MergeRow }
  | { readonly ok: false; readonly reason: 'not-found' | 'not-pending' | 'invalid'; readonly message: string }

async function act(io: EvolutionIoLike, home: string, now: () => number, id: string, type: 'approve' | 'reject'): Promise<PendingActionResult> {
  void now
  return await pairLedger(io, home).transact<PendingActionResult>(tx => {
    const row = tx.rows().find(item => item.id === id)
    if (row === undefined) return { ok: false, reason: 'not-found', message: 'pending row not found: ' + id }
    if (row.state !== 'pending') return { ok: false, reason: 'not-pending', message: 'row is not pending: ' + row.state }
    const event = type === 'approve'
      ? { type: 'approved' as const, runId: row.runId ?? 'approve:' + id }
      : { type: 'skipped' as const, reason: 'rejected', origin: 'human' as const }
    const moved = tx.transition(id, event, row.version)
    if (!moved.ok) return { ok: false, reason: 'invalid', message: moved.message }
    if (moved.row === null) return { ok: false, reason: 'invalid', message: 'transition produced no row' }
    return { ok: true, row: v4ToLegacy(moved.row) }
  })
}

export async function approvePending(io: EvolutionIoLike, home: string, now: () => number, id: string): Promise<PendingActionResult> {
  return await act(io, home, now, id, 'approve')
}

export async function rejectPending(io: EvolutionIoLike, home: string, now: () => number, id: string): Promise<PendingActionResult> {
  return await act(io, home, now, id, 'reject')
}
