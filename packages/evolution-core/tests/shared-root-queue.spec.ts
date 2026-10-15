// @tier pre-tag
/** G1/1.4 (S2-02): ONE serial queue per skill ROOT, shared by every SkillLibrary instance.
 *
 * The observable is the READ, because that is what the plan names: "two different instances updating one
 * skill - the second must READ what the first wrote". Two earlier fixtures for this were vacuous (a
 * Promise.all race the fake io never interleaved, and a content assertion that holds under replace-body
 * semantics whatever the locking does). So this one records the bytes every read of the target returned:
 *
 * shared queue : reads are v1 then v2 - the second instance starts only after the first committed.
 * per-instance : reads are v1 then v1 - both took the same baseline, and the second write was planned
 *                from stale bytes (the silent lost update S2-02 describes). */
import { expect, it } from 'vitest'
import { SkillLibrary } from '../src/skill-store.ts'
import { randomUUID } from 'node:crypto'
import { fakeIo } from '../../test-support/fake-io.ts'

const BODY = (name: string, text: string): string => '---\nname: ' + name + '\ndescription: Demo.\n---\n\n' + text

it('G1/1.4: the second instance reads what the first wrote (one queue per root)', async () => {
  const base = fakeIo()
  const root = '/skills-g14-' + randomUUID()
  const target = root + '/shared-root/SKILL.md'
  const seen: string[] = []
  const io = {
    ...base,
    async readText(path: string) {
      const value = await base.readText(path)
      if (path.replaceAll('\\', '/') === target) seen.push(value ?? 'null')
      return value
    },
  }
  // G1/1.4: the queue is PER ROOT and lives at module scope, so a spec that shares `/skills` with the
  // rest of the package shares their queue too - and then the read order this test asserts depends on
  // what other specs left in it. A private root keeps the criterion about THIS pair of instances.
  const one = new SkillLibrary(root, io)
  const two = new SkillLibrary(root, io)
  expect(await one.create('shared-root', BODY('shared-root', 'v1'), 'foreground')).toMatchObject({ ok: true })
  seen.length = 0
  const [first, second] = await Promise.all([
    one.update('shared-root', BODY('shared-root', 'v2'), 'foreground'),
    two.update('shared-root', BODY('shared-root', 'v3'), 'foreground'),
  ])
  expect(first).toMatchObject({ ok: true })
  expect(second).toMatchObject({ ok: true })
  // `update` reads twice (CAS baseline + body), so the FIRST instance contributes two v1 reads and the
  // second contributes two v2 reads. The criterion is about the second instance: the LAST read of the
  // target must be the first instance write - with a per-instance queue it would still be v1.
  expect(seen.length).toBeGreaterThanOrEqual(4)
  expect(seen[0]).toContain('v1')
  expect(seen[seen.length - 1]).toContain('v2')
})
