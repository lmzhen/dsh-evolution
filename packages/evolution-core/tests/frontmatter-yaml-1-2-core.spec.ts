/**
 * S2.1 (PLAN 2026-09-16, audit P2-1): the family's strict frontmatter parser
 * is the `yaml` package (YAML 1.2 core schema) — the same dependency the
 * platform's skill-filesystem catalog parses with. These cases pin the
 * value-level alignment that motivated the switch away from js-yaml (YAML 1.1
 * full schema): the two parsers read different values out of the SAME bytes,
 * and every difference was a family/platform visibility split.
 *
 * Oracle: `yaml`'s own parse — the platform's reading of the same block.
 */
import { describe, expect, it } from 'vitest'
import { parse as platformParse } from 'yaml'
import { frontmatterCatalogInvalid, normalizeFrontmatter, parseFrontmatter, SkillLibrary, validateFrontmatter, yamlPlainScalarNeedsQuotes } from '@deepseek-ai/dsh-evolution-core'
import { fakeIo } from '../../test-support/fake-io.ts'

/** The platform's reading of one frontmatter field. */
function platformField(content: string, key: string): unknown {
  const lines = content.split('\n')
  const end = lines.indexOf('---', 1)
  return (platformParse(lines.slice(1, end).join('\n')) as Record<string, unknown>)[key]
}

describe('S2.1: YAML 1.2 core alignment for plain frontmatter scalars', () => {
  it('description: 2026-09-16 is a string on both sides — the family accepts it and list() publishes the original text', async () => {
    // js-yaml (YAML 1.1) read a DATE here, so the family's strict read flagged
    // a non-string description while the platform accepted the file — the
    // date-shaped description was the canonical P2-1 split.
    const content = '---\nname: dated-skill\ndescription: 2026-09-16\n---\n\n# Dated\n'
    expect(platformField(content, 'description')).toBe('2026-09-16')
    expect(parseFrontmatter(content)?.frontmatter['description']).toBe('2026-09-16')
    expect(frontmatterCatalogInvalid(content)).toBe(false)
    expect(validateFrontmatter(content, 'dated-skill')).toBeNull()

    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    const created = await lib.create('dated-skill', content)
    expect(created.ok, created.message).toBe(true)
    const listed = await lib.list()
    expect(listed.find(entry => entry.name === 'dated-skill')?.description).toBe('2026-09-16')
  })

  it('description: 2026-13-45 (an impossible date) stays the literal string — no silent overflow', () => {
    // js-yaml 1.1 normalized the impossible date to 2027-02-14; YAML 1.2 core
    // (the platform) keeps the literal text. The family now agrees with the
    // platform instead of silently rewriting an author's value.
    const content = '---\nname: odd-date-skill\ndescription: 2026-13-45\n---\n\n# Odd\n'
    expect(platformField(content, 'description')).toBe('2026-13-45')
    expect(parseFrontmatter(content)?.frontmatter['description']).toBe('2026-13-45')
    expect(frontmatterCatalogInvalid(content)).toBe(false)
  })

  it('description: yes reads "yes" on both sides', () => {
    const content = '---\nname: yes-skill\ndescription: yes\n---\n\n# Y\n'
    expect(platformField(content, 'description')).toBe('yes')
    expect(parseFrontmatter(content)?.frontmatter['description']).toBe('yes')
    expect(frontmatterCatalogInvalid(content)).toBe(false)
  })

  it('description: +.inf unquoted is catalogInvalid (the platform reads a float) and self-heals quoted', () => {
    // Under YAML 1.2 core `+.inf` coerces to Infinity, so the platform's
    // stringField reads ABSENT and the file is dropped — the family must flag
    // the split (fail-closed) and the write path must quote it: quoted, both
    // sides read the literal string.
    const raw = '---\nname: inf-skill\ndescription: +.inf\n---\n\n# Inf\n'
    expect(typeof platformField(raw, 'description')).toBe('number')
    expect(parseFrontmatter(raw)?.platformStringSplit).toEqual([{ key: 'description', kind: 'scalar' }])
    expect(frontmatterCatalogInvalid(raw)).toBe(true)

    const result = normalizeFrontmatter(raw)
    expect(result.changed, result.issues.join('; ')).toBe(true)
    expect(result.content).toContain('description: "+.inf"')
    expect(frontmatterCatalogInvalid(result.content)).toBe(false)
    // The quoted value round-trips as the same text on both sides.
    expect(platformField(result.content, 'description')).toBe('+.inf')
    expect(parseFrontmatter(result.content)?.frontmatter['description']).toBe('+.inf')
  })

  it('the fast path flags the SIGNED inf/nan forms and leaves prose alone', () => {
    expect(yamlPlainScalarNeedsQuotes('+.inf')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('-.inf')).toBe(true)
    // NaN is UNSIGNED under both parsers (review B-P2): a signed form is a
    // plain string, so it must NOT be quoted — flagging it rewrote a correct
    // value and reported a false catalog-invalid.
    expect(yamlPlainScalarNeedsQuotes('+.nan')).toBe(false)
    // `-.nan` is still quoted — by the PRE-EXISTING leading-indicator rule
    // (`-` opens a block sequence entry), not by the nan branch. Quoting a
    // string is always safe; only the false catalog-invalid was the defect.
    expect(yamlPlainScalarNeedsQuotes('-.nan')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('.inf')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('.nan')).toBe(true)
    // YAML 1.1 bool words are strings under BOTH parsers — never flagged.
    expect(yamlPlainScalarNeedsQuotes('yes')).toBe(false)
    expect(yamlPlainScalarNeedsQuotes('no')).toBe(false)
  })
})
