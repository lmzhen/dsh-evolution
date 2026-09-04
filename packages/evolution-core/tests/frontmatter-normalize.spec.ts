import { describe, expect, it } from 'vitest'
import { frontmatterYamlUnsafeValues, normalizeFrontmatter, yamlPlainScalarNeedsQuotes } from '../src/index.ts'

describe('yamlPlainScalarNeedsQuotes (0.3.11)', () => {
  it('flags the plain-scalar hazards the strict YAML catalog rejects', () => {
    expect(yamlPlainScalarNeedsQuotes('a: b')).toBe(true) // mapping separator
    expect(yamlPlainScalarNeedsQuotes('search: arXiv')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('word # comment')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('- lead')).toBe(true) // sequence indicator
    expect(yamlPlainScalarNeedsQuotes('* anchor')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('| literal')).toBe(true)
  })

  it('accepts safe values and already-quoted/flow forms', () => {
    expect(yamlPlainScalarNeedsQuotes('正常句子')).toBe(false)
    expect(yamlPlainScalarNeedsQuotes('Maintain the plugin family.')).toBe(false)
    expect(yamlPlainScalarNeedsQuotes('"quoted: value"')).toBe(false)
    expect(yamlPlainScalarNeedsQuotes("'quoted # value'")).toBe(false)
    expect(yamlPlainScalarNeedsQuotes('[Capitalized, Tags]')).toBe(false)
    expect(yamlPlainScalarNeedsQuotes('{a: b}')).toBe(false)
    expect(yamlPlainScalarNeedsQuotes('')).toBe(false)
  })
})

describe('frontmatterYamlUnsafeValues (0.3.11)', () => {
  const unquoted = '---\nname: demo-skill\ndescription: Search: arXiv papers by keyword.\n---\n\n# Demo\n'

  it('flags raw unquoted values and never re-flags values already quoted by the write path', () => {
    expect(frontmatterYamlUnsafeValues(unquoted).map(e => e.key)).toEqual(['description'])
    const normalized = normalizeFrontmatter(unquoted).content
    expect(frontmatterYamlUnsafeValues(normalized)).toEqual([])
    expect(frontmatterYamlUnsafeValues('---\nname: a\ndescription: Safe text.\n---\n\n# A\n')).toEqual([])
  })
})

describe('normalizeFrontmatter (0.3.11)', () => {
  const valid = '---\nname: demo-skill\ndescription: Run and debug Python tests.\n---\n\n# Demo\n'
  const colonDesc = '---\nname: demo-skill\ndescription: Search: arXiv papers by keyword.\n---\n\n# Demo\n'

  it('wraps the violating value in double quotes and reports the field', () => {
    const result = normalizeFrontmatter(colonDesc)
    expect(result.changed).toBe(true)
    expect(result.fields).toEqual(['description'])
    expect(result.issues).toEqual([])
    expect(result.content).toContain('description: "Search: arXiv papers by keyword."')
    expect(normalizeFrontmatter(result.content).changed).toBe(false)
  })

  it('leaves valid YAML byte-identical and unchanged', () => {
    const result = normalizeFrontmatter(valid)
    expect(result.changed).toBe(false)
    expect(result.content).toBe(valid)
    expect(result.fields).toEqual([])
  })

  it('is idempotent and never touches the body', () => {
    const once = normalizeFrontmatter(colonDesc).content
    const twice = normalizeFrontmatter(once)
    expect(twice.content).toBe(once)
    expect(twice.content).toContain('# Demo\n')
  })

  it('falls back to single quotes (with doubling) for quotes/backslash values — no catch-22 (0.3.11 fix)', () => {
    const innerQuote = '---\nname: demo-skill\ndescription: He said "hi" then: left\n---\n\n# Demo\n'
    const result = normalizeFrontmatter(innerQuote)
    expect(result.changed).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.content).toContain('description: \'He said "hi" then: left\'')
    const backslash = '---\nname: demo-skill\ndescription: path a\\b: left\n---\n\n# Demo\n'
    const result2 = normalizeFrontmatter(backslash)
    expect(result2.changed).toBe(true)
    expect(result2.issues).toEqual([])
    expect(result2.content).toContain('description: \'path a\\b: left\'')
    // Apostrophes stay on the double-quote path.
    const apostrophe = "---\nname: demo-skill\ndescription: It's a: search tool\n---\n\n# Demo\n"
    const result3 = normalizeFrontmatter(apostrophe)
    expect(result3.changed).toBe(true)
    expect(result3.content).toContain('description: "It\'s a: search tool"')
  })

  it('reports control characters as issues and never mangles them', () => {
    const bad = '---\nname: demo-skill\ndescription: has\u0000control: value\n---\n\n# Demo\n'
    const result = normalizeFrontmatter(bad)
    expect(result.changed).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.content).toBe(bad)
  })

  it('never rewrites a key line with an embedded line break (no continuation loss)', () => {
    // Genuinely mixed style: dominant CRLF, but this one key line carries a
    // lone \n continuation — rewriting would drop the continuation text.
    const mixed = '---\r\ndescription: a: b\n  continuation here\r\nname: demo-skill\r\n---\r\n'
    const result = normalizeFrontmatter(mixed)
    expect(result.content).toBe(mixed)
    expect(result.fields).toEqual([])
  })

  it('preserves the file line-ending style', () => {
    const crlf = '---\r\ndescription: a: b\r\nname: demo-skill\r\n---\r\n\r\n# Demo\r\n'
    const result = normalizeFrontmatter(crlf)
    expect(result.changed).toBe(true)
    expect(result.content).toContain('description: "a: b"\r\n')
  })

  it('returns unchanged when frontmatter is absent or malformed', () => {
    expect(normalizeFrontmatter('# no frontmatter\n').changed).toBe(false)
    expect(normalizeFrontmatter('---\nno-close\n').changed).toBe(false)
  })
})
