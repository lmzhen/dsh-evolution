/**
 * Execute a merge undo from its commit receipt. The receipt names the unit and archived
 * sources; this module resolves versions, plans the cross-skill undo and runs the shared
 * executor. No command/routing logic here.
 */
import type { SkillVersion } from '@deepseek-ai/dsh-evolution-core'
import { executeUnitUndo, planUnitUndoAcross, type UnitUndoExecution, type UnitUndoMember, type UnitUndoSink } from '@deepseek-ai/dsh-evolution-core'
import type { CommitReceipt } from './commit-receipt.ts'

export interface MergeUndoPort extends UnitUndoSink {
  listVersions(skill: string): Promise<readonly SkillVersion[]>
}

export async function undoMergeReceipt(receipt: CommitReceipt, port: MergeUndoPort): Promise<UnitUndoExecution> {
  const targetVersions = (await port.listVersions(receipt.target)).filter(entry => entry.unitId === receipt.unitId)
  if (targetVersions.length === 0) {
    return { ok: false, message: 'unit ' + receipt.unitId + ' is not in the target history; refusing to guess', reverted: [] }
  }
  const members: UnitUndoMember[] = [{ skill: receipt.target, entries: targetVersions, status: 'live', ...(receipt.create ? { createdInUnit: true } : {}) }]
  for (const source of receipt.sources) {
    const live = await port.readSkill(source)
    members.push({
      skill: source,
      entries: (await port.listVersions(source)).filter(entry => entry.unitId === receipt.unitId),
      status: live === null ? 'archived' : 'live',
      ...(live === null ? { archivedPath: 'archive' } : {}),
    })
  }
  const plan = planUnitUndoAcross(members)
  if (plan.refusals.length > 0) {
    return { ok: false, message: 'merge undo preflight refused: ' + plan.refusals.join('; '), reverted: [] }
  }
  return await executeUnitUndo(plan, port)
}
