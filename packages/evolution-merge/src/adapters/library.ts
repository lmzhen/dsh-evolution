/**
 * Library adapter: the only place the merge domain touches SkillLibrary's commit kernel.
 * The domain stays port-shaped; this file is the composition seam.
 */
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import type { CommitPort } from '../commit-execute.ts'

export function skillLibraryPort(skills: SkillLibrary): CommitPort {
  const archivedNames = (skills as unknown as { archivedNames?: () => Promise<string[] | null> }).archivedNames
  return {
    readSkill: name => skills.read(name),
    isArchived: async (name) => {
      if (typeof archivedNames !== 'function') return false
      const names = await archivedNames.call(skills)
      return names === null ? true : names.includes(name)
    },
    commitMerge: plan => skills.commitMerge(plan),
  }
}
