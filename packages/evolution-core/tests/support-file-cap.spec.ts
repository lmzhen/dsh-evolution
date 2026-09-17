/**
 * V4 (design §16.6): upstream applies the 100k-character cap to EVERY written
 * file, not just SKILL.md. It lands here in report mode first — a write over the
 * cap succeeds and says so — with `enforce` available and a net-shrink repair
 * path in both modes, so a legacy over-cap file can always be brought back down
 * instead of becoming unmaintainable.
 */
import { expect, it } from 'vitest'
import { CONTENT_SPLIT_HINT, DEFAULT_SKILL_LIMITS, MAX_SKILL_CONTENT_CHARS, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { fakeIo } from '../../test-support/fake-io.ts'

const BODY = '---\nname: cap-skill\ndescription: D.\n---\n\nBody.\n'
const over = (extra: number): string => 'x'.repeat(MAX_SKILL_CONTENT_CHARS + extra)
const CAP_WARNING = `over the ${MAX_SKILL_CONTENT_CHARS}-character cap`

async function make(limits = DEFAULT_SKILL_LIMITS): Promise<{ lib: SkillLibrary; io: ReturnType<typeof fakeIo> }> {
  const io = fakeIo()
  const lib = new SkillLibrary('/skills', io, limits)
  expect((await lib.create('cap-skill', BODY, 'foreground')).ok).toBe(true)
  return { lib, io }
}

it('V4: report mode writes an over-cap support file and says so', async () => {
  const { lib } = await make()
  const written = await lib.writeSupportFile('cap-skill', 'references/big.md', over(20_000), 'foreground')
  expect(written.ok, written.message).toBe(true)
  expect(written.message).toContain(CAP_WARNING)
  expect(written.message).toContain('plan a split')
})

it('V4: enforce mode refuses the same write and names the split hint', async () => {
  const { lib } = await make({ ...DEFAULT_SKILL_LIMITS, supportFileCharPolicy: 'enforce' })
  const written = await lib.writeSupportFile('cap-skill', 'references/big.md', over(20_000), 'foreground')
  expect(written.ok).toBe(false)
  expect(written.message).toContain('exceeds')
  expect(written.message).toContain(CONTENT_SPLIT_HINT)
})

it('V4: enforce mode still lets an over-cap file SHRINK (the repair path)', async () => {
  const { lib, io } = await make({ ...DEFAULT_SKILL_LIMITS, supportFileCharPolicy: 'enforce' })
  await io.writeText('/skills/cap-skill/references/legacy.md', over(5_000))
  const shrink = await lib.writeSupportFile('cap-skill', 'references/legacy.md', over(1_000), 'foreground')
  expect(shrink.ok, shrink.message).toBe(true)
  const grow = await lib.writeSupportFile('cap-skill', 'references/legacy.md', over(9_000), 'foreground')
  expect(grow.ok).toBe(false)
})

it('V4: the patch path carries the same cap and the same repair exemption', async () => {
  const { lib, io } = await make()
  await io.writeText('/skills/cap-skill/references/doc.md', 'y'.repeat(MAX_SKILL_CONTENT_CHARS - 1_000) + '\n')
  const grown = await lib.patch('cap-skill', 'y'.repeat(500), 'y'.repeat(5_000), 'references/doc.md')
  expect(grown.ok, grown.message).toBe(true)
  expect(grown.message).toContain('plan a split')
  const strict = new SkillLibrary('/skills', io, { ...DEFAULT_SKILL_LIMITS, supportFileCharPolicy: 'enforce' })
  const refused = await strict.patch('cap-skill', 'y'.repeat(5_000), 'y'.repeat(6_000), 'references/doc.md')
  expect(refused.ok).toBe(false)
  const shrunk = await strict.patch('cap-skill', 'y'.repeat(6_000), 'y'.repeat(1_000), 'references/doc.md')
  expect(shrunk.ok, shrunk.message).toBe(true)
})

it('V4: supportFileChars measures only files that can possibly exceed the cap, and never guesses', async () => {
  const io = fakeIo()
  const withSize = {
    ...io,
    // A size probe is what makes the byte pre-filter possible; chars <= bytes is
    // why a file under the cap in BYTES cannot be over it in characters.
    // Mirror fakeIo's own path normalization: the store joins with the platform
    // separator, and fakeIo keys its map with forward slashes.
    size: async (path: string): Promise<number | null> => {
      const content = io.files.get(path.replaceAll('\\', '/'))
      return content === undefined ? null : Buffer.byteLength(content, 'utf8')
    },
  }
  const lib = new SkillLibrary('/skills', withSize, DEFAULT_SKILL_LIMITS)
  await lib.create('cap-skill', BODY, 'foreground')
  await lib.writeSupportFile('cap-skill', 'references/small.md', 's'.repeat(500), 'foreground')
  const big = '中'.repeat(MAX_SKILL_CONTENT_CHARS + 10)
  await lib.writeSupportFile('cap-skill', 'references/big.md', big, 'foreground')
  const measured = await lib.supportFileChars('cap-skill')
  expect(measured).toEqual({ 'references/big.md': big.length })
  // No size probe at all: unknown, never an empty map that reads as all-clear.
  const blind = new SkillLibrary('/skills', io, DEFAULT_SKILL_LIMITS)
  expect(await blind.supportFileChars('cap-skill')).toBeNull()
})
