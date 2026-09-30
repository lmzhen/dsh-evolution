/**
 * E2 probe (2026-09-30): does removing a support file leave a version entry, and does that entry read as a
 * support change?
 *
 * The open item claimed it did not ("remove_file never casts an action entry, so the support-remove
 * vocabulary is unreachable") and the answer decides whether the history face needs a fix or only a test.
 * The write path is the authority: a removal calls audit(name, 'remove_file', before, null, …), and
 * recordVersions skips only when BOTH sides are null - so the removed bytes are the entry's content.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SKILL_LIMITS, loadVersions, newSkillLibrary, nodeEvolutionIo, versionActionKind, versionTarget,
} from '../src/index.ts'

const SUPPORT = 'a support file\n'
const BODY = '---\nname: probe-skill\ndescription: probe\n---\nBody.\n'

describe('a removed support file stays visible in the version chain', () => {
  it('records the removal, keeps the bytes it removed, and reads as a support change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-support-remove-'))
    try {
      const io = nodeEvolutionIo()
      const library = newSkillLibrary({ config: { root: join(root, 'skills') }, io, limits: DEFAULT_SKILL_LIMITS })
      expect((await library.create('probe-skill', BODY, 'foreground')).ok).toBe(true)
      expect((await library.writeSupportFile('probe-skill', 'references/note.md', SUPPORT, 'foreground')).ok).toBe(true)
      expect((await library.removeSupportFile('probe-skill', 'references/note.md', 'foreground')).ok).toBe(true)

      const versions = await loadVersions(join(root, 'skills'), io, 'probe-skill')
      const removal = versions.filter(entry => entry.action === 'remove_file')
      // The claim under test: the removal DID leave an entry.
      expect(removal).toHaveLength(1)
      // And the classification/vocabulary the face reads is reachable for it.
      expect(versionActionKind('remove_file')).toBe('support-remove')
      expect(versionTarget('remove_file')).toBe('support')
      // The entry carries the bytes it removed, so a reader can see what was deleted, and it names the
      // file it belonged to (the support chain's rows are per file).
      expect(removal[0]?.hash).toBeTruthy()
      expect(removal[0]?.path).toBe('references/note.md')
      // It is the NEWEST entry: the removal is the last thing that happened to this skill.
      expect(versions[versions.length - 1]?.action).toBe('remove_file')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
