/**
 * S1.2 (v37 P2-1): the content limit is judged on the bytes that land on disk,
 * and a NET SHRINK of an already-over-limit file is the repair path.
 *
 * Writes normalize with `trimEnd() + '\n'`, so the old raw-length check let a
 * file at exactly the limit (no trailing newline) land one byte over — after
 * which EVERY patch/update was refused, leaving the skill unmaintainable through
 * `skill_manage` with no way back.
 */
import { expect, it } from 'vitest'
import { DEFAULT_SKILL_LIMITS, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { fakeIo } from '../../test-support/fake-io.ts'

const LIMIT = 300
const LIMITS = { ...DEFAULT_SKILL_LIMITS, maxSkillContentChars: LIMIT }
/** A body that makes the WHOLE document exactly `total` characters (no trailing newline). */
function documentOf(total: number, name = 'lim-skill'): string {
  const head = `---\nname: ${name}\ndescription: D.\n---\n\n`
  return head + 'x'.repeat(total - head.length)
}

it('S1.2: the limit counts the bytes that land on disk, not the raw argument', async () => {
  const io = fakeIo()
  const lib = new SkillLibrary('/skills', io, LIMITS)
  // Exactly `LIMIT` characters with no trailing newline: the write would append
  // one and land at LIMIT+1, so this must be refused (it used to be accepted and
  // then brick the file).
  const atLimit = documentOf(LIMIT)
  expect(atLimit.length).toBe(LIMIT)
  const refused = await lib.create('lim-skill', atLimit, 'foreground')
  expect(refused.ok).toBe(false)
  expect(refused.message).toContain('exceeds')
  // One character shorter lands exactly AT the limit.
  const underLimit = documentOf(LIMIT - 1)
  const created = await lib.create('lim-skill', underLimit, 'foreground')
  expect(created.ok, created.message).toBe(true)
  const onDisk = (await io.readText('/skills/lim-skill/SKILL.md')) ?? ''
  expect(onDisk.length).toBe(LIMIT)
})

it('S1.2: shrinking an over-limit file is allowed; growing it is not', async () => {
  const io = fakeIo()
  const lib = new SkillLibrary('/skills', io, LIMITS)
  // Seed a file that is already over the limit (a legacy/hand-edited tree).
  const oversized = `${documentOf(LIMIT + 200, 'big-skill')}\n`
  await io.writeText('/skills/big-skill/SKILL.md', oversized)
  expect(oversized.trimEnd().length + 1).toBeGreaterThan(LIMIT)
  // A patch that makes the file smaller is the repair path.
  const shrunk = await lib.patch('big-skill', 'x'.repeat(200), 'y'.repeat(50))
  expect(shrunk.ok, shrunk.message).toBe(true)
  // An update that shrinks further is allowed too.
  const updated = await lib.update('big-skill', documentOf(LIMIT - 50, 'big-skill'), 'foreground')
  expect(updated.ok, updated.message).toBe(true)
  // Growing it back over the limit is still refused.
  const grown = await lib.update('big-skill', documentOf(LIMIT + 100, 'big-skill'), 'foreground')
  expect(grown.ok).toBe(false)
  expect(grown.message).toContain('exceeds')
})
