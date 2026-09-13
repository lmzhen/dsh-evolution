/**
 * S1.1 (v37 P1-4): a MIXED-ending SKILL.md is readable and writable.
 *
 * `frontmatterBlock` used to pick ONE newline style for the whole file, so a file
 * whose first line ends with LF and any later line with CRLF looked like a file
 * with NO frontmatter: the family refused every write with a message naming the
 * `---` fence (which was present), while the platform's own parser read the same
 * bytes fine. The block is now located by splitting on LF and tolerating a
 * trailing CR per line — upstream `skill-filesystem`'s rule. The write paths must
 * keep working, and the CRLF detection (unsafe-value scan) must not go blind.
 */
import { describe, expect, it } from 'vitest'
import { frontmatterCatalogInvalid, parseFrontmatter, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { fakeIo } from '../../test-support/fake-io.ts'

const LF = '---\nname: mixed-skill\ndescription: Mixed endings.\n---\n\n# Body\n\nKeep me.\n'
// LF first line, CRLF from the body on (PowerShell Add-Content / editor / git hunk).
const MIXED = LF.replace('# Body\n\nKeep me.\n', '# Body\r\n\r\nKeep me.\r\n')
const CRLF = LF.replace(/\n/g, '\r\n')
const UNSAFE_CRLF = '---\r\nname: unsafe-skill\r\ndescription: has: a colon\r\n---\r\n\r\n# Body\r\n\r\nKeep.\r\n'
// An unterminated flow collection makes the strict parser throw, so the LENIENT
// line reader (which splits the block with the returned `nl`) is the only reader.
const LENIENT_CRLF = '---\r\nname: lenient-skill\r\ndescription: lenient value\r\ntags: [a, b\r\n---\r\n\r\n# Body\r\n\r\nKeep.\r\n'

describe('mixed line endings in SKILL.md frontmatter (S1.1, v37 P1-4)', () => {
  it('reads a mixed-ending file exactly like a uniform one', () => {
    expect(MIXED).toContain('\r\n')
    expect(MIXED.startsWith('---\n')).toBe(true)
    const mixed = parseFrontmatter(MIXED)
    const crlf = parseFrontmatter(CRLF)
    const lfResult = parseFrontmatter(LF)
    expect(mixed).not.toBeNull()
    expect(mixed?.frontmatter.name).toBe('mixed-skill')
    expect(mixed?.frontmatter.description).toBe('Mixed endings.')
    expect(mixed?.frontmatter).toEqual(crlf?.frontmatter)
    expect(mixed?.frontmatter).toEqual(lfResult?.frontmatter)
    expect(mixed?.body).toContain('# Body')
  })

  it('keeps the CRLF readers alive — parity with the LF form', () => {
    // (a) the unsafe-value scan must still SEE CRLF lines: the per-line CR strip
    // must not make every line look like it was already handled.
    expect(frontmatterCatalogInvalid(UNSAFE_CRLF)).toBe(true)
    expect(frontmatterCatalogInvalid(UNSAFE_CRLF.replace(/\r\n/g, '\n'))).toBe(true)
    // (b) the lenient reader splits the block with the returned `nl`, so its
    // values must survive the kept CR as well.
    expect(parseFrontmatter(LENIENT_CRLF)?.frontmatter.description).toBe('lenient value')
    expect(parseFrontmatter(LENIENT_CRLF.replace(/\r\n/g, '\n'))?.frontmatter.description).toBe('lenient value')
    // A clean mixed file is NOT reported as catalog-invalid any more.
    expect(frontmatterCatalogInvalid(MIXED)).toBe(false)
  })

  it('list() and the write paths work on a mixed-ending tree', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await io.writeText('/skills/mixed-skill/SKILL.md', MIXED)
    const summaries = await lib.list()
    expect(summaries.find(summary => summary.name === 'mixed-skill')?.description).toBe('Mixed endings.')
    const updated = await lib.update('mixed-skill', LF.replace('Keep me.', 'Keep me!'), 'foreground')
    expect(updated.ok, updated.message).toBe(true)
    const patched = await lib.patch('mixed-skill', 'Keep me!', 'Still here.')
    expect(patched.ok, patched.message).toBe(true)
    const read = await io.readText('/skills/mixed-skill/SKILL.md')
    expect(read).toContain('Still here.')
  })
})
