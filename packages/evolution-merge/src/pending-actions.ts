/**
 * Pending approval actions. The row lookup and transition happen in one v3
 * transactRows transaction, so two clients approving the same row cannot both win.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { MergeRow } from './contracts.ts'
import { v3ToLegacy } from './domain/row-v3-bridge.ts'
import { transactRows } from './state.ts'

export type PendingActionResult =
  | { readonly ok: true; readonly row: MergeRow }
  | { readonly ok: false; readonly reason: 'not-found' | 'not-pending' | 'invalid'; readonly message: string }

async function act(io: EvolutionIoLike, home: string, now: () => number, id: string, type: 'approve' | 'reject'): Promise<PendingActionResult> {
  void now
  return await transactRows<PendingActionResult>(io, home, tx => {
    const row = tx.rows().find(item => item.id === id)
    if (row === undefined) return { ok: false as const, reason: 'not-found' as const, message: 'pending row not found: ' + id }
    if (row.state !== 'pending') return { ok: false as const, reason: 'not-pending' as const, message: 'row is not pending: ' + row.state }
    const event = type === 'approve'
      ? { type: 'approved' as const, runId: row.runId ?? 'approve:' + id }
      : { type: 'skipped' as const, reason: 'rejected', origin: 'human' as const }
    const moved = tx.transition(id, event, row.version)
    if (!moved.ok) return { ok: false as const, reason: 'invalid' as const, message: moved.message }
    if (moved.row === null) return { ok: false as const, reason: 'invalid' as const, message: 'transition produced no row' }
    return { ok: true as const, row: v3ToLegacy(moved.row) }
  })
}

export async function approvePending(io: EvolutionIoLike, home: string, now: () => number, id: string): Promise<PendingActionResult> {
  return await act(io, home, now, id, 'approve')
}

export async function rejectPending(io: EvolutionIoLike, home: string, now: () => number, id: string): Promise<PendingActionResult> {
  return await act(io, home, now, id, 'reject')
}
