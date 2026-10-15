// @tier pre-tag
/** G0/0.7 (S4-01): the three-state read is what makes "unreadable" a REFUSAL instead of an absent.
 *
 * The two absorbing reads answer `null` for ENOENT/EISDIR and rethrow anything else, so a caller that
 * only sees null-or-throw cannot tell "the file is not there" from "I could not read it" without writing
 * its own catch - which three call sites did, and one of them turned the second case into "no anchor".
 * Here all three states are pinned at the entry: present / absent / unknown-with-reason. */
import { expect, it } from 'vitest'
import { SkillLibrary } from '../src/skill-store.ts'
import { isAbsent, isPresent, isUnknown } from '../src/probe.ts'
import { fakeIo } from '../../test-support/fake-io.ts'

const BODY = (name: string): string => '---\nname: ' + name + '\ndescription: Demo.\n---\n\nbody'

it('G0/0.7: the three-state read separates present, absent and unreadable', async () => {
  const base = fakeIo()
  // The failure is armed only AFTER the fixture is built: creating the skill reads it too, and arming
  // the throw up front made the create itself fail (which is how this criterion first went red).
  let lockReads = false
  const io = {
    ...base,
    async readText(path: string) {
      // A real read failure that is NOT "missing": the case the absorbing reads rethrow and the
      // three-state entry has to name, because the callers refuse on it.
      if (lockReads && path.replaceAll(String.fromCharCode(92), '/').includes('locked-skill/')) {
        const error = new Error('EACCES: locked') as Error & { code?: string }
        error.code = 'EACCES'
        throw error
      }

      return await base.readText(path)
    },
  }
  const skills = new SkillLibrary('/skills', io)
  expect((await skills.create('ok-skill', BODY('ok-skill'), 'foreground')).ok).toBe(true)
  expect((await skills.create('locked-skill', BODY('locked-skill'), 'foreground')).ok).toBe(true)
  lockReads = true
  const present = await skills.readSkillProbe('ok-skill')
  expect(isPresent(present)).toBe(true)
  const absent = await skills.readSkillProbe('never-existed')
  expect(isAbsent(absent)).toBe(true)
  const unreadable = await skills.readSkillProbe('locked-skill')
  expect(isUnknown(unreadable)).toBe(true)
  if (isUnknown(unreadable)) expect(unreadable.reason).toContain('EACCES')
  const supportUnreadable = await skills.readSupportFileProbe('locked-skill', 'references/x.md')
  expect(isUnknown(supportUnreadable)).toBe(true)
})
