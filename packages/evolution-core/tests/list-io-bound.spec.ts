// @tier pre-tag
/** G1/1.7 (S7-01): listing a tree costs ONE listing, not one existence probe per entry.
 *
 * The invariant the plan asks for is an UPPER BOUND, not a `> 0` smoke check: with N skills, answering
 * "which skills exist and what do they say" must not call the medium once per entry to ask whether the
 * file it is about to read is there. This asserts the sharp form - `exists` is NEVER called on this path
 * (a probe is exactly the second read of one fact the finding names), and the root is listed once. */
import { expect, it } from 'vitest'
import { SkillLibrary } from '../src/skill-store.ts'
import { fakeIo } from '../../test-support/fake-io.ts'

const BODY = (name: string): string => '---\nname: ' + name + '\ndescription: Demo.\n---\n\nbody'

it('G1/1.7: one listing plus one read per skill, and no existence probe per entry', async () => {
  const base = fakeIo()
  const calls = { exists: 0, readText: 0, list: 0, rootLists: 0 }
  const io = {
    ...base,
    async exists(path: string) { calls.exists += 1; return await base.exists(path) },
    async readText(path: string) { calls.readText += 1; return await base.readText(path) },
    async list(path: string) {
      calls.list += 1
      if (path.replaceAll(String.fromCharCode(92) + String.fromCharCode(92), '/') === '/skills') calls.rootLists += 1
      return await base.list(path)
    },
  }
  const skills = new SkillLibrary('/skills', io)
  const N = 5
  for (let i = 0; i < N; i += 1) await skills.create(`skill-${i}`, BODY(`skill-${i}`), 'foreground')
  calls.exists = 0; calls.readText = 0; calls.list = 0; calls.rootLists = 0
  const listed = await skills.list({ withContent: true })
  expect(listed).toHaveLength(N)
  // The upper bound, in its sharp form: no existence probe at all, and the root listed once.
  expect(calls.exists).toBe(0)
  expect(calls.rootLists).toBe(1)
  // One read per skill is the floor for content; the count must not exceed it.
  expect(calls.readText).toBeLessThanOrEqual(N)
})
