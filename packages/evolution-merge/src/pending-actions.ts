/**
 * Pending approval actions. The row lookup and the transition happen in one
 * mutateMergeState transaction, so two clients approving the same row cannot both win.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { transition } from './coordinator.ts'
import type { MergeRow } from './contracts.ts'
import { mutateMergeState } from './state.ts'

export type PendingActionResult =
  | { readonly ok: true; readonly row: MergeRow }
  | { readonly ok: false; readonly reason: 'not-found' | 'not-pending' | 'invalid'; readonly message: string }

async function act(io: EvolutionIoLike, home: string, now: () => number, id: string, type: 'approve' | 'reject'): Promise<PendingActionResult> {
  return await mutateMergeState<PendingActionResult>(io, home, now, (rows) => {
    const index = rows.findIndex(row => row.id === id)
    if (index < 0) return { rows, result: { ok: false as const, reason: 'not-found' as const, message: 'pending row not found: ' + id } }
    const current = rows[index] as MergeRow
    if (current.state !== 'pending') return { rows, result: { ok: false as const, reason: 'not-pending' as const, message: 'row is not pending: ' + current.state } }
    const event = type === 'approve'
      ? { type: 'approve' as const, at: new Date(now()).toISOString() }
      : { type: 'reject' as const, at: new Date(now()).toISOString() }
    const next = transition(current, event)
    if (!next.ok || next.row === null) return { rows, result: { ok: false as const, reason: 'invalid' as const, message: next.ok ? 'transition produced no row' : next.message } }
    const copy = [...rows]
    copy[index] = next.row
    return { rows: copy, result: { ok: true as const, row: next.row } }
  })
}

export async function approvePending(io: EvolutionIoLike, home: string, now: () => number, id: string): Promise<PendingActionResult> {
  return await act(io, home, now, id, 'approve')
}

export async function rejectPending(io: EvolutionIoLike, home: string, now: () => number, id: string): Promise<PendingActionResult> {
  return await act(io, home, now, id, 'reject')
}
