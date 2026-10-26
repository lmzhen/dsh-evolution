/** Pure invariant checks over one pair snapshot. */
import { CLOSED_REASONS, type PairSnapshot } from './model.ts'

export function checkPair(snapshot: PairSnapshot): string[] {
  const problems: string[] = []
  if (snapshot.id.length === 0) problems.push('id is empty')
  if (snapshot.pairKey.length === 0) problems.push('pairKey is empty')
  if (snapshot.a.length === 0 || snapshot.b.length === 0) problems.push('a/b is empty')
  if (!Number.isInteger(snapshot.version) || snapshot.version < 0) problems.push('version must be a non-negative integer')
  if (snapshot.attempts < 0) problems.push('attempts must be non-negative')
  if (snapshot.state === 'closed') {
    if (snapshot.closedReason === undefined || !CLOSED_REASONS.includes(snapshot.closedReason)) problems.push('closed requires closedReason in ' + CLOSED_REASONS.join('/'))
    if (snapshot.failure !== undefined) problems.push('closed must not carry a failure')
  }
  if (snapshot.state === 'failed') {
    if (snapshot.failure === undefined) problems.push('failed requires a failure')
    if (snapshot.closedReason !== undefined) problems.push('failed must not carry closedReason')
  }
  if (snapshot.state === 'committed') {
    if (snapshot.receipt === undefined) problems.push('committed requires a receipt')
    if (snapshot.failure !== undefined) problems.push('committed must not carry a failure')
    if (snapshot.unitId === undefined) problems.push('committed requires unitId')
  }
  if (snapshot.state === 'committing' && snapshot.unitId === undefined) problems.push('committing requires unitId')
  if (snapshot.state === 'staged' && (snapshot.stageRef === undefined || snapshot.stageRef.length === 0)) problems.push('staged requires stageRef')
  if ((snapshot.state === 'pending' || snapshot.state === 'approved') && snapshot.decision === undefined) problems.push(snapshot.state + ' requires a decision')
  if ((snapshot.state === 'pending' || snapshot.state === 'approved') && snapshot.target === undefined) problems.push(snapshot.state + ' requires a target')
  if (snapshot.state === 'committed' && snapshot.receipt !== undefined && snapshot.receipt.unitId !== snapshot.unitId) problems.push('receipt.unitId must equal unitId')
  return problems
}
