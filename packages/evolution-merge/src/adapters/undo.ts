/**
 * SkillLibrary-backed undo sink. Blobs are content-addressed but the library exposes them by
 * version, so the first readBlob call indexes all version bodies once; an undo is rare enough
 * that this is preferable to adding a second hash index.
 */
import { contentHash, type SkillLibrary, type UnitUndoSink } from '@deepseek-ai/dsh-evolution-core'
import type { MergeUndoPort } from '../undo-merge.ts'

export function skillLibraryUndoPort(skills: SkillLibrary): MergeUndoPort {
  let blobs: Map<string, string> | undefined
  const readBlob = async (hash: string): Promise<string | null> => {
    if (blobs === undefined) {
      blobs = new Map()
      for (const summary of await skills.list()) {
        for (const version of await skills.listVersions(summary.name)) {
          const body = await skills.readVersion(summary.name, version.v)
          if (body !== null) blobs.set(contentHash(body), body)
        }
      }
    }
    return blobs.get(hash) ?? null
  }
  const sink: UnitUndoSink = {
    readSkill: name => skills.read(name),
    readSupport: (name, path) => skills.readSupportFile(name, path),
    readBlob,
    async hasArchived(name) { return (await skills.read(name)) === null },
    restoreFromArchive: name => skills.restoreFromArchive(name),
    archive: (name, reason) => skills.archive(name, { reason }),
    updateSkill: (name, body, anchor) => skills.update(name, body, undefined, anchor),
    writeSupportFile: (name, path, content, anchor) => skills.writeSupportFile(name, path, content, undefined, anchor),
    removeSupportFile: (name, path, anchor) => skills.removeSupportFile(name, path, undefined, anchor),
  }
  return { ...sink, listVersions: name => skills.listVersions(name) }
}
