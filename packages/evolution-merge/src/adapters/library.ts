/**
 * Library adapter: the only place the merge domain touches SkillLibrary's commit kernel.
 * The domain stays port-shaped; this file is the composition seam.
 */
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import type { CommitPort } from '../commit-execute.ts'

export function skillLibraryPort(skills: SkillLibrary): CommitPort {
  return {
    readSkill: name => skills.read(name),
    commitMerge: plan => skills.commitMerge(plan),
  }
}
