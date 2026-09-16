/**
 * S2.2 (v37 P2-9): a platform STRING field carrying a non-string YAML value.
 *
 * `description: [a, b]` is a real YAML sequence. The platform catalog reads
 * `name`/`description` with `stringField` (skill-filesystem: a non-empty string,
 * else undefined), so a sequence reads as ABSENT there and the whole file is
 * ignored, while the family synthesized the string `"[a, b]"`,
 * judged it catalog-valid, and published a description no model ever sees.
 * These cases pin the family's verdict to the platform's own YAML reading and
 * pin the write-path refusal (which is what stops a create from minting such a
 * file in the first place).
 */
import { describe, expect, it } from 'vitest'
// S2.1 (PLAN 2026-09-16): the platform oracle is the `yaml` package (the
// dependency skill-filesystem parses with, YAML 1.2 core schema).
import { parse as loadStrictYaml } from 'yaml'
import { frontmatterCatalogInvalid, parseFrontmatter, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { fakeIo } from '../../test-support/fake-io.ts'

/** The frontmatter block as the platform's parser extracts it. */
function blockOf(content: string): string {
  const lines = content.split('\n')
  const end = lines.indexOf('---', 1)
  return lines.slice(1, end).join('\n')
}

/** The value the platform's YAML parser reads for one key — the input
 * `stringField` decides on. */
function platformField(content: string, key: string): unknown {
  return (loadStrictYaml(blockOf(content)) as Record<string, unknown>)[key]
}

const FLOW = '---\nname: flow-skill\ndescription: [alpha, beta]\n---\n\n# Body\n'
const BLOCK_SEQ = '---\nname: block-seq-skill\ndescription:\n  - alpha\n  - beta\n---\n\n# Body\n'
const MAPPING = '---\nname: mapping-skill\ndescription: {a: b}\n---\n\n# Body\n'
const NUMBER = '---\nname: number-skill\ndescription: 123\n---\n\n# Body\n'
const SAFE = '---\nname: safe-skill\ndescription: Safe text.\nrelated_skills: [alpha-skill, beta-skill]\n---\n\n# Body\n'

describe('platform string fields in SKILL.md frontmatter (S2.2, v37 P2-9)', () => {
  it('a flow sequence description gets the platform verdict (whole file ignored)', () => {
    // Oracle: the platform's parser yields an ARRAY here, so its `stringField`
    // returns undefined and `parseSkillFile` logs "frontmatter requires name and
    // description", dropping the file.
    expect(platformField(FLOW, 'description')).toEqual(['alpha', 'beta'])
    expect(typeof platformField(FLOW, 'description')).not.toBe('string')
    expect(parseFrontmatter(FLOW)?.platformStringSplit).toEqual([{ key: 'description', kind: 'sequence' }])
    expect(parseFrontmatter(FLOW)?.catalogInvalid).toBe(true)
    expect(frontmatterCatalogInvalid(FLOW)).toBe(true)
  })

  it('a BLOCK sequence is the same split (the raw-line scan cannot see it)', () => {
    expect(platformField(BLOCK_SEQ, 'description')).toEqual(['alpha', 'beta'])
    expect(parseFrontmatter(BLOCK_SEQ)?.platformStringSplit).toEqual([{ key: 'description', kind: 'sequence' }])
    expect(frontmatterCatalogInvalid(BLOCK_SEQ)).toBe(true)
  })

  it('a mapping and a non-string name are splits too', () => {
    expect(parseFrontmatter(MAPPING)?.platformStringSplit).toEqual([{ key: 'description', kind: 'mapping' }])
    expect(frontmatterCatalogInvalid(MAPPING)).toBe(true)
    const listName = '---\nname: [not, a, name]\ndescription: Demo.\n---\n\n# Body\n'
    expect(parseFrontmatter(listName)?.platformStringSplit).toEqual([{ key: 'name', kind: 'sequence' }])
    expect(frontmatterCatalogInvalid(listName)).toBe(true)
    const whenToUse = '---\nname: when-skill\ndescription: Demo.\nwhenToUse: [alpha]\n---\n\n# Body\n'
    expect(parseFrontmatter(whenToUse)?.platformStringSplit).toEqual([{ key: 'whenToUse', kind: 'sequence' }])
    expect(frontmatterCatalogInvalid(whenToUse)).toBe(true)
  })

  it('a SEQUENCE-valued non-platform field stays catalog-valid', () => {
    // `related_skills: [a, b]` is the documented sequence field — flagging it
    // would flood the audit with the family's own routing convention.
    expect(parseFrontmatter(SAFE)?.platformStringSplit).toEqual([])
    expect(frontmatterCatalogInvalid(SAFE)).toBe(false)
    expect(parseFrontmatter(SAFE)?.frontmatter.related_skills).toBe('[alpha-skill, beta-skill]')
  })

  it('create refuses the sequence form with a readable error', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    const created = await lib.create('flow-skill', FLOW)
    expect(created.ok).toBe(false)
    expect(created.message).toContain('must be a string')
    expect(created.message).toContain('ignores the whole file')
    expect(created.message).toContain('description')
    // Nothing was written: the refusal precedes the commit point.
    expect(await io.exists('/skills/flow-skill/SKILL.md')).toBe(false)
  })

  it('update and patch refuse it too, and the corrected form is the escape hatch', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    expect((await lib.create('safe-skill', SAFE)).ok).toBe(true)
    const updated = await lib.update('safe-skill', FLOW.replace('flow-skill', 'safe-skill'))
    expect(updated.ok).toBe(false)
    expect(updated.message).toContain('must be a string')
    const patched = await lib.patch('safe-skill', 'Safe text.', 'Patched text.')
    expect(patched.ok).toBe(true)
    // A legacy file on disk keeps its bytes and is refused a body patch until
    // the frontmatter is fixed (fail-closed, and the fix is one update away).
    await io.writeText('/skills/flow-skill/SKILL.md', FLOW)
    const legacyPatch = await lib.patch('flow-skill', 'Body', 'Body (patched)')
    expect(legacyPatch.ok).toBe(false)
    expect(legacyPatch.message).toContain('must be a string')
    const repaired = await lib.update('flow-skill', '---\nname: flow-skill\ndescription: "[alpha, beta]"\n---\n\n# Body\n')
    expect(repaired.ok, repaired.message).toBe(true)
    const onDisk = await io.readText('/skills/flow-skill/SKILL.md')
    expect(onDisk).toContain('description: "[alpha, beta]"')
    expect(frontmatterCatalogInvalid(onDisk ?? '')).toBe(false)
  })

  it('number/boolean descriptions keep the auto-quote repair (not refused)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    // The E-47 path owns this shape: quoting restores the string the author
    // meant, so the write path repairs it instead of refusing.
    expect(parseFrontmatter(NUMBER)?.platformStringSplit).toEqual([{ key: 'description', kind: 'scalar' }])
    expect(frontmatterCatalogInvalid(NUMBER)).toBe(true)
    const created = await lib.create('number-skill', NUMBER)
    expect(created.ok, created.message).toBe(true)
    expect(await io.readText('/skills/number-skill/SKILL.md')).toContain('description: "123"')
  })
})
