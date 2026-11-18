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
  | 'update'
  | 'patch'
  | 'delete'
  | 'write_file'
  | 'remove_file'
  | 'restructure'
  | 'extract'
  | 'feedback'
  | 'pin'
  | 'unpin'

export interface SkillActionMeta {
  /** Does this action write skill bytes (and therefore enter usage/journal)? */
  readonly mutates: boolean
  /** Does the action address one skill by name? */
  readonly needsName: boolean
  /** none = read-only; write = SkillLibrary write path; approval = staged gate. */
  readonly gate: 'none' | 'write' | 'approval'
  /** Whether the user-facing change summary is model-required, host-derived, or absent. */
  readonly summary: 'required' | 'host' | 'none'
}

export const SKILL_ACTIONS: Readonly<Record<SkillActionId, SkillActionMeta>> = Object.freeze({
  list: { mutates: false, needsName: false, gate: 'none', summary: 'none' },
  review: { mutates: false, needsName: false, gate: 'none', summary: 'none' },
  create: { mutates: true, needsName: true, gate: 'write', summary: 'host' },
  update: { mutates: true, needsName: true, gate: 'write', summary: 'host' },
  patch: { mutates: true, needsName: true, gate: 'write', summary: 'host' },
  delete: { mutates: true, needsName: true, gate: 'approval', summary: 'required' },
  write_file: { mutates: true, needsName: true, gate: 'write', summary: 'host' },
  remove_file: { mutates: true, needsName: true, gate: 'write', summary: 'host' },
  restructure: { mutates: true, needsName: true, gate: 'write', summary: 'required' },
  // extract may be addressed by proposal_id instead of a skill name.
  extract: { mutates: true, needsName: false, gate: 'write', summary: 'required' },
  feedback: { mutates: false, needsName: true, gate: 'none', summary: 'none' },
  pin: { mutates: false, needsName: true, gate: 'none', summary: 'none' },
  unpin: { mutates: false, needsName: true, gate: 'none', summary: 'none' },
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

