/**
 * Library adapter: the only place the merge domain touches SkillLibrary's commit kernel.
 * The domain stays port-shaped; this file is the composition seam.
 */
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import type { CommitPort } from '../commit-execute.ts'

export function skillLibraryPort(skills: SkillLibrary): CommitPort {
  return {
    readSkill: name => skills.read(name),
    isArchived: async name => {
      if (typeof skills.archivedNames !== 'function') return false
      const names = await skills.archivedNames()
      return names === null ? true : names.includes(name)
    },
    commitMerge: plan => skills.commitMerge(plan),
  }
}
