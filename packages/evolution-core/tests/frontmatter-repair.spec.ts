// @tier ci-only
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ensureSkillFrontmatter, parseFrontmatter } from '../src/frontmatter.ts'

describe('ensureSkillFrontmatter', () => {
  it('adds a loadable header to a headerless body', () => {
    const repaired = ensureSkillFrontmatter('# Notes\n\nBody text.', 'notes', 'Turn notes into an index')
    expect(repaired.repaired).toBe(true)
    expect(repaired.content.startsWith('---\n')).toBe(true)
    expect(parseFrontmatter(repaired.content)?.frontmatter).toMatchObject({ name: 'notes', description: 'Turn notes into an index.' })
    expect(repaired.content).toContain('# Notes')
  })

  it('passes an existing header through byte-identical', () => {
    const text = '---\nname: notes\ndescription: Existing.\n---\n\n# Notes\n'
    expect(ensureSkillFrontmatter(text, 'notes')).toEqual({ content: text, repaired: false })
  })

  it('leaves a malformed existing fence for the validator to report', () => {
    const text = '---\nname: notes\n# no closing fence\n# Notes'
    expect(ensureSkillFrontmatter(text, 'notes')).toEqual({ content: text, repaired: false })
  })
})