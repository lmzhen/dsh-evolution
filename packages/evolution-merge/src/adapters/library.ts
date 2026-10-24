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
    isNameOccupied: async (name) => {
      const probe = (skills as unknown as { skillDirExists?: (name: string) => Promise<boolean> }).skillDirExists
      return typeof probe === 'function' ? await probe.call(skills, name) : false
    },
    async readSupportFiles(name) {
      if (typeof skills.listSupportFiles !== 'function') return []
      const probe = await skills.listSupportFiles(name)
      if (probe.kind === 'unknown') throw new Error('support file list unknown: ' + name)
      if (probe.kind === 'absent') return []
      return await Promise.all(probe.value.map(async (path) => {
        const content = await skills.readSupportFile(name, path)
        if (content === null) throw new Error('support file disappeared: ' + name + '/' + path)
        return { path, content }
      }))
    },
  }
}
