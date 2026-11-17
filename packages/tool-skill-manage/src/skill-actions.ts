/**
 * The ONE action table for skill_manage. Handlers still live in the tool until
 * the mutation pipeline is extracted, but every cross-cutting decision
 * (read-only, name requirement, gate) reads this table instead of duplicating
 * an action list.
 */
import type { SkillActionResult } from '@deepseek-ai/dsh-evolution-core/skills'

export type SkillActionId =
  | 'list'
  | 'review'
  | 'create'
  | 'edit'
  | 'update'
  | 'patch'
  | 'delete'
  | 'write_file'
  | 'remove_file'
  | 'restructure'
  | 'extract'
  | 'pin'
  | 'unpin'

export interface SkillActionMeta {
  /** Does this action write skill bytes (and therefore enter usage/journal)? */
  readonly mutates: boolean
  /** Does the action address one skill by name? */
  readonly needsName: boolean
  /** none = read-only; write = SkillLibrary write path; approval = staged gate. */
  readonly gate: 'none' | 'write' | 'approval'
}

export const SKILL_ACTIONS: Readonly<Record<SkillActionId, SkillActionMeta>> = Object.freeze({
  list: { mutates: false, needsName: false, gate: 'none' },
  review: { mutates: false, needsName: false, gate: 'none' },
  create: { mutates: true, needsName: true, gate: 'write' },
  edit: { mutates: true, needsName: true, gate: 'write' },
  update: { mutates: true, needsName: true, gate: 'write' },
  patch: { mutates: true, needsName: true, gate: 'write' },
  delete: { mutates: true, needsName: true, gate: 'approval' },
  write_file: { mutates: true, needsName: true, gate: 'write' },
  remove_file: { mutates: true, needsName: true, gate: 'write' },
  restructure: { mutates: true, needsName: true, gate: 'write' },
  // extract may be addressed by proposal_id instead of a skill name.
  extract: { mutates: true, needsName: false, gate: 'write' },
  pin: { mutates: false, needsName: true, gate: 'none' },
  unpin: { mutates: false, needsName: true, gate: 'none' },
})

export function skillActionOf(action: unknown): SkillActionMeta | undefined {
  return typeof action === 'string' && Object.prototype.hasOwnProperty.call(SKILL_ACTIONS, action)
    ? SKILL_ACTIONS[action as SkillActionId]
    : undefined
}

/** The one commit seam every table-dispatched action passes through. */
export async function commitSkillAction(run: () => Promise<SkillActionResult>): Promise<SkillActionResult> {
  return run()
}

export function isReadOnlySkillAction(action: unknown): boolean {
  return skillActionOf(action)?.mutates === false
}
