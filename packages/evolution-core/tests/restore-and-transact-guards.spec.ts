/**
 * S1.4 (v37 P1-5 / P2-7): the two failure shapes a whole-tree restore and a
 * transact-contract violation used to hide.
 *
 * (a) A root listing that FAILS must refuse the restore — reading it as "no
 *     entries" degraded the clear into a merge and still reported ok:true.
 * (b) A transact backend that never invokes the task (the V6-19 contract) must
 *     refuse the write/delete — the pre-read value otherwise stood in for the
 *     real outcome, so `removed` / `written` were reported while nothing landed.
 */
import { expect, it } from 'vitest'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { fakeIo } from '../../test-support/fake-io.ts'

const SKILL = (name: string) => `---\nname: ${name}\ndescription: D.\n---\n\n# ${name}\n\nBody.\n`

it('S1.4 (a): a failed root listing refuses the restore instead of merging', async () => {
  const io = fakeIo()
  const lib = new SkillLibrary('/skills', io)
  await lib.create('alpha', SKILL('alpha'), 'foreground')
  await lib.create('beta', SKILL('beta'), 'foreground')
  // `snapshotAll` returns the snapshot PATH (a string), not a result object.
  const snapshotPath = await lib.snapshotAll('pre-test')
  expect(typeof snapshotPath).toBe('string')
  // A skill created AFTER the snapshot must not survive a restore...
  await lib.create('gamma', SKILL('gamma'), 'foreground')
  // ...but a listing failure must refuse the whole operation, not merge.
  // Delegate through the prototype chain (a spread would drop the backend's
  // prototype methods and turn every other call into `undefined`).
  const failing = Object.create(io, {
    list: {
      value: (path: string) => (path === '/skills' ? Promise.reject(new Error('EACCES: permission denied')) : io.list(path)),
    },
  }) as unknown as EvolutionIoLike
  const restore = await new SkillLibrary('/skills', failing).restoreLatestSnapshot()
  expect(restore.ok).toBe(false)
  expect(restore.message).toContain('refused')
  // Nothing was cleared: all three skills are still on disk.
  expect(await io.exists('/skills/gamma/SKILL.md')).toBe(true)
  expect(await io.exists('/skills/alpha/SKILL.md')).toBe(true)
})

it('S1.4 (b): a transact backend that never runs the task cannot report success', async () => {
  const io = fakeIo()
  // Seed with a WORKING library: create/update already carry their own taskRan
  // guard, so the violations must be exercised on the paths that lacked one.
  const seeder = new SkillLibrary('/skills', io)
  expect((await seeder.create('alpha', SKILL('alpha'), 'foreground')).ok).toBe(true)
  expect((await seeder.writeSupportFile('alpha', 'references/keep.md', 'KEEP')).ok).toBe(true)
  const violating = async (): Promise<unknown> => ({})
  const lib = new SkillLibrary('/skills', io, undefined, undefined, violating as never)
  // remove_file: the delete runs inside the (violating) transaction.
  const removed = await lib.removeSupportFile('alpha', 'references/x.md')
  expect(removed.ok).toBe(false)
  // restructure/write path: applyTreeChange must refuse an uninvoked transaction.
  const restructured = await lib.restructure('alpha', [{ heading: 'Body', toFile: 'references/body.md' }], 'foreground')
  expect(restructured.ok).toBe(false)
  expect(await io.readText('/skills/alpha/references/keep.md')).toBe('KEEP')
})
