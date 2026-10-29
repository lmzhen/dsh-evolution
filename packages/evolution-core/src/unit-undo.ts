/**
 * Cross-skill unit undo executor.
 *
 * Phase A is a zero-write preflight: every live path still carries the unit's after-bytes and
 * every pre-unit blob is readable. Phase B restores archived members, applies support files,
 * writes the body last, then archives a target the unit created. Any preflight refusal means
 * no write at all.
 */
import { contentHash } from './mutations.ts'
import type { SkillActionResult } from './skill-store.ts'
import type { UnitUndoOp, UnitUndoPlan } from './unit-undo-plan.ts'

export interface UnitUndoSink {
  readSkill(skill: string): Promise<string | null>
  readSupport(skill: string, path: string): Promise<string | null>
  /** Read one blob by hash; null means the blob is gone. */
  readBlob(hash: string): Promise<string | null>
  /** Optional archived-member probe; without it the restore itself is the first proof. */
  hasArchived?(skill: string): Promise<boolean>
  restoreFromArchive(skill: string): Promise<SkillActionResult>
  archive(skill: string, reason: string): Promise<SkillActionResult>
  updateSkill(skill: string, body: string, anchor: { sha256: string }): Promise<SkillActionResult>
  writeSupportFile(skill: string, path: string, content: string, anchor?: { sha256: string }): Promise<SkillActionResult>
  removeSupportFile(skill: string, path: string, anchor: { sha256: string }): Promise<SkillActionResult>
}

export interface UnitUndoExecution {
  readonly ok: boolean
  readonly message: string
  readonly reverted: readonly string[]
}

interface PreparedRestore {
  readonly skill: string
  readonly archivedPath: string
}

interface PreparedOp extends UnitUndoOp {
  readonly bytes: string
  readonly live: string
  /** The path was absent at preflight; recreate it without a content anchor. */
  readonly absent: boolean
}

export async function executeUnitUndo(plan: UnitUndoPlan, sink: UnitUndoSink): Promise<UnitUndoExecution> {
  const refusals: string[] = [...plan.refusals]
  const restores: PreparedRestore[] = []
  for (const restore of plan.restores) {
    if (sink.hasArchived !== undefined) {
      const present = await sink.hasArchived(restore.skill)
      if (!present) refusals.push(`${restore.skill}（归档成员不在 .archive）`)
      else restores.push(restore)
      continue
    }
    restores.push(restore)
  }
  const prepared: PreparedOp[] = []
  for (const op of plan.ops) {
    const live = op.path === '' ? await sink.readSkill(op.skill) : await sink.readSupport(op.skill, op.path)
    if (live === null) {
      // The unit may have DELETED this path (extract moving an exclusive support file). Its
      // after-hash is then the absent-content hash, and undo must recreate it from the pre-unit
      // blob. A remove op against an already-absent path is a no-op.
      // A remove op against an already-absent path is a no-op (the unit's deletion landed).
      if (op.remove) continue
      if (op.expectedHash === contentHash('')) {
        const bytes = op.preUnitHash === undefined ? null : await sink.readBlob(op.preUnitHash)
        if (bytes === null) {
          refusals.push(`${op.skill}/${op.path === '' ? 'SKILL.md' : op.path}（单元前字节读不到：blob ${op.preUnitHash ?? '(missing)'}）`)
          continue
        }
        prepared.push({ ...op, bytes, live: '', absent: true })
        continue
      }
      refusals.push(`${op.skill}/${op.path === '' ? 'SKILL.md' : op.path}（盘上文件不存在）`)
      continue
    }
    if (contentHash(live) !== op.expectedHash) {
      refusals.push(`${op.skill}/${op.path === '' ? 'SKILL.md' : op.path}（盘上字节已变，回退会覆盖别人的改动）`)
      continue
    }
    if (op.remove) {
      prepared.push({ ...op, bytes: '', live, absent: false })
      continue
    }
    const bytes = op.preUnitHash === undefined ? null : await sink.readBlob(op.preUnitHash)
    if (bytes === null) {
      refusals.push(`${op.skill}/${op.path === '' ? 'SKILL.md' : op.path}（单元前字节读不到：blob ${op.preUnitHash ?? '(missing)'}）`)
      continue
    }
    prepared.push({ ...op, bytes, live, absent: false })
  }
  if (refusals.length > 0) {
    return { ok: false, message: `整单元撤销未开始（零写）—— 预检未通过：${refusals.join('；')}。修好后可重试。`, reverted: [] }
  }

  const reverted: string[] = []
  const done = (): string => reverted.length === 0 ? '无' : reverted.join(', ')
  for (const restore of restores) {
    const result = await sink.restoreFromArchive(restore.skill)
    if (!result.ok) return { ok: false, message: `恢复「${restore.skill}」失败：${result.message} —— 撤销未完成（已回退：${done()}）。`, reverted }
    reverted.push(restore.skill)
  }
  const supportOps = prepared.filter(op => op.path !== '')
  const bodyOps = prepared.filter(op => op.path === '')
  for (const op of supportOps) {
    const result = op.remove
      ? await sink.removeSupportFile(op.skill, op.path, { sha256: op.expectedHash })
      : op.absent ? await sink.writeSupportFile(op.skill, op.path, op.bytes) : await sink.writeSupportFile(op.skill, op.path, op.bytes, { sha256: op.expectedHash })
    if (!result.ok) return { ok: false, message: `${op.skill}/${op.path}：${result.message} —— 撤销未完成（已回退：${done()}）。`, reverted }
    reverted.push(op.skill + '/' + op.path)
  }
  for (const op of bodyOps) {
    const result = await sink.updateSkill(op.skill, op.bytes, { sha256: op.expectedHash })
    if (!result.ok) return { ok: false, message: `${op.skill}/SKILL.md：${result.message} —— 撤销未完成（已回退：${done()}）。`, reverted }
    reverted.push(op.skill + '/SKILL.md')
  }
  for (const skill of plan.archiveTargets) {
    const result = await sink.archive(skill, 'merge undone')
    if (!result.ok) return { ok: false, message: `归档新目标「${skill}」失败：${result.message} —— 撤销未完成（已回退：${done()}）。`, reverted }
    reverted.push(skill)
  }
  return { ok: true, message: `已按单元撤销：${reverted.join(', ')}。`, reverted }
}
