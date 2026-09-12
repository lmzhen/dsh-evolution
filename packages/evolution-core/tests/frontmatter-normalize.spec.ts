import { describe, expect, it } from 'vitest'
import { load as loadStrictYaml } from 'js-yaml'
import { frontmatterCatalogInvalid, normalizeFrontmatter, parseFrontmatter, relatedSkillNames, yamlPlainScalarNeedsQuotes } from '../src/index.ts'

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

  it('V27 G0.3 (core-a-07): a block scalar header is not a plain scalar needing quotes', () => {
    // The indicator belongs to the value position: quoting it re-reads as the
    // literal ">" and leaves the indented continuation lines dangling, so the
    // rewritten block no longer parses and the write path rejected the skill.
    expect(yamlPlainScalarNeedsQuotes('>')).toBe(false)
    expect(yamlPlainScalarNeedsQuotes('|')).toBe(false)
    expect(yamlPlainScalarNeedsQuotes('>-')).toBe(false)
    expect(yamlPlainScalarNeedsQuotes('|+')).toBe(false)
    expect(yamlPlainScalarNeedsQuotes('>2')).toBe(false)
    // A longer value that merely STARTS with an indicator is still unsafe.
    expect(yamlPlainScalarNeedsQuotes('| literal')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('>x')).toBe(true)
  })
})

describe('V27 G0.3 (core-a-07): block scalars survive the write path and read back as values', () => {
  const folded = '---\nname: demo-skill\ndescription: >\n  Long description that the\n  model folded across lines.\n---\n\n# Demo\n\nbody\n'
  const literal = '---\nname: demo-skill\ndescription: |\n  first line\n  second line\n---\n\n# Demo\n\nbody\n'

  it('leaves a block scalar untouched and reports no issue', () => {
    const result = normalizeFrontmatter(folded)
    expect(result.issues).toEqual([])
    expect(result.changed).toBe(false)
    expect(result.content).toBe(folded)
    expect(frontmatterCatalogInvalid(folded)).toBe(false)
  })

  it('reads the block content as the value rather than the indicator', () => {
    expect(parseFrontmatter(folded)?.frontmatter['description'])
      .toBe('Long description that the model folded across lines.')
    expect(parseFrontmatter(literal)?.frontmatter['description']).toBe('first line\nsecond line')
  })
})

describe('frontmatterCatalogInvalid (0.3.11; v28 G2.5 migrated from the removed frontmatterYamlUnsafeValues)', () => {
  const unquoted = '---\nname: demo-skill\ndescription: Search: arXiv papers by keyword.\n---\n\n# Demo\n'

  it('flags raw unquoted values and never re-flags values already quoted by the write path', () => {
    expect(frontmatterCatalogInvalid(unquoted)).toBe(true)
    const normalized = normalizeFrontmatter(unquoted).content
    expect(frontmatterCatalogInvalid(normalized)).toBe(false)
    expect(frontmatterCatalogInvalid('---\nname: a\ndescription: Safe text.\n---\n\n# A\n')).toBe(false)
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

  it('rolls back a rewrite that fails real-parser verification (multiline flow — P3-4)', () => {
    const multilineFlow = '---\nname: demo-skill\nrelated_skills: [a,\n  b]\n---\n\n# Demo\n'
    const result = normalizeFrontmatter(multilineFlow)
    expect(result.content).toBe(multilineFlow) // never mutates the value
    expect(result.changed).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0) // fail-loud, caller rejects
    // The valid rewrites still succeed and survive verification.
    const normal = normalizeFrontmatter('---\nname: demo-skill\ndescription: a: b\nrelated_skills: [x, y]\n---\n\n# Demo\n')
    expect(normal.changed).toBe(true)
    expect(normal.issues).toEqual([])
    expect(normal.content).toContain('description: "a: b"')
  })

  it('frontmatterBlock is the single owner: strict closing line, parse/normalize agree (P3-3)', () => {
    const looseClose = '---\nname: demo-skill\ndescription: Demo.\n----\n\n# Demo\n'
    // A closing line of `----` is NOT a frontmatter terminator under the
    // shared strict rule — parser and normalizer must agree (previously the
    // parser's indexOf matched \n---- slurping the remainder).
    expect(parseFrontmatter(looseClose)).toBeNull()
    expect(normalizeFrontmatter(looseClose).changed).toBe(false)
    expect(frontmatterCatalogInvalid(looseClose)).toBe(false)
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

  it('V10-02 (P2-3): a duplicated key is refused in issues and never rewrites the safe first line', () => {
    // The second `description` carries the unsafe value; the first is safe.
    // The old key→Map rewrite quoted the FIRST line with the SECOND line's
    // value (corrupting safe bytes that the last-wins YAML reader then masked).
    const dup = '---\nname: demo-skill\ndescription: Safe text.\ndescription: Search: arXiv papers\n---\n\n# Demo\n'
    const result = normalizeFrontmatter(dup)
    expect(result.changed).toBe(false)
    expect(result.content).toBe(dup) // no line was rewritten
    expect(result.issues.some(issue => issue.includes('duplicate') && issue.includes('description'))).toBe(true)
  })

  it('V10-02 (P2-3): per-line rewrite quotes each unsafe line from its OWN value', () => {
    const two = '---\nname: demo-skill\ndescription: a: b\nrelated_skills: keyword # tag\n---\n\n# Demo\n'
    const result = normalizeFrontmatter(two)
    expect(result.changed).toBe(true)
    expect(result.fields).toEqual(['description', 'related_skills'])
    expect(result.issues).toEqual([])
    expect(result.content).toContain('description: "a: b"')
    expect(result.content).toContain('related_skills: "keyword # tag"')
  })
})

describe('V27 G2.1: one frontmatter read — values come from the strict parser', () => {
  const blockOf = (content: string): string => {
    const lines = content.split('\n')
    const end = lines.indexOf('---', 1)
    return lines.slice(1, end).join('\n')
  }
  // js-yaml is the parser the platform catalog and normalizeFrontmatter's
  // rewrite verification use, so the assertion is against the platform's own
  // reading of the same bytes — not against a second implementation of mine.
  const strictValue = (content: string, key: string): unknown =>
    (loadStrictYaml(blockOf(content)) as Record<string, unknown>)[key]

  it('publishes what the strict catalog parses, not the lenient line text', () => {
    // ` # ` starts a YAML comment: the catalog reads `routing word`, so the
    // family must publish exactly that. The lenient line scan published
    // `routing word # trailing note` — routing text only the family ever saw.
    const commented = '---\nname: demo-skill\ndescription: routing word # trailing note\n---\n\n# Demo\n'
    expect(parseFrontmatter(commented)?.frontmatter['description']).toBe(strictValue(commented, 'description'))
    expect(parseFrontmatter(commented)?.frontmatter['description']).toBe('routing word')

    const doubleQuoted = '---\nname: demo-skill\ndescription: "routing word # kept"\n---\n\n# Demo\n'
    expect(parseFrontmatter(doubleQuoted)?.frontmatter['description']).toBe('routing word # kept')

    const singleQuoted = "---\nname: demo-skill\ndescription: 'routing: kept'\n---\n\n# Demo\n"
    expect(parseFrontmatter(singleQuoted)?.frontmatter['description']).toBe('routing: kept')
  })

  it('reads a sequence as the inline form relatedSkillNames scans', () => {
    const flow = '---\nname: demo-skill\ndescription: Demo.\nrelated_skills: [alpha-skill, beta-skill]\n---\n\n# Demo\n'
    expect(parseFrontmatter(flow)?.frontmatter['related_skills']).toBe('[alpha-skill, beta-skill]')
    expect(relatedSkillNames(flow)).toEqual(['alpha-skill', 'beta-skill'])
    // A block sequence was previously invisible — the lenient line scan read
    // the empty header value — so the references factor and the learning-graph
    // edges lost those links without a trace.
    const sequence = '---\nname: demo-skill\ndescription: Demo.\nrelated_skills:\n  - alpha-skill\n  - beta-skill\n---\n\n# Demo\n'
    expect(relatedSkillNames(sequence)).toEqual(['alpha-skill', 'beta-skill'])
  })

  it('falls back to the lenient scan only for a block the strict parser rejects, and says so', () => {
    // `Search: arXiv papers` is not valid YAML as an unquoted value: the
    // platform drops the file, and the family keeps routing from the lenient
    // read — reported through catalogInvalid instead of a silent split.
    const unsafe = '---\nname: demo-skill\ndescription: Search: arXiv papers\n---\n\n# Demo\n'
    const read = parseFrontmatter(unsafe)
    expect(read?.frontmatter['description']).toBe('Search: arXiv papers')
    expect(read?.catalogInvalid).toBe(true)
    expect(frontmatterCatalogInvalid(unsafe)).toBe(true)

    const safe = '---\nname: demo-skill\ndescription: Safe text.\n---\n\n# Demo\n'
    expect(frontmatterCatalogInvalid(safe)).toBe(false)
    expect(parseFrontmatter(safe)?.catalogInvalid).toBe(false)
    // An empty or comment-only block has no entries, so it is not "invalid as
    // written": the catalog's complaint is the missing name, which
    // validateFrontmatter reports.
    expect(frontmatterCatalogInvalid('---\n---\n\n# Demo\n')).toBe(false)
    expect(frontmatterCatalogInvalid('# no frontmatter\n')).toBe(false)
  })

  it('the audit verdict and the published values always come from one read', () => {
    const cases = [
      '---\nname: demo-skill\ndescription: Safe text.\n---\n\n# Demo\n',
      '---\nname: demo-skill\ndescription: routing word # note\n---\n\n# Demo\n',
      '---\nname: demo-skill\ndescription: Search: arXiv papers\n---\n\n# Demo\n',
      '---\nname: demo-skill\ndescription: >\n  Folded routing text\n  across two lines.\n---\n\n# Demo\n',
      '---\nname: demo-skill\ndescription: "already: quoted"\n---\n\n# Demo\n',
    ]
    for (const content of cases) {
      const read = parseFrontmatter(content)
      // Loadable by the catalog → the family publishes the catalog's own value.
      if (!frontmatterCatalogInvalid(content)) {
        expect(read?.frontmatter['description']).toBe(String(strictValue(content, 'description')).trim())
      }
      // The verdict is body-independent, so a body-less file cannot slip past
      // the audit merely because the reader refuses it.
      const bodyless = `${content.slice(0, content.lastIndexOf('---') + 3)}\n`
      expect(frontmatterCatalogInvalid(bodyless)).toBe(frontmatterCatalogInvalid(content))
    }
  })

  it('requires the exact fence line upstream requires, tolerating only CR', () => {
    const exact = '---\nname: demo-skill\ndescription: Demo.\n---\n\n# Demo\n'
    expect(parseFrontmatter(exact)?.frontmatter['name']).toBe('demo-skill')
    // upstream skill-filesystem.parseFrontmatter compares the first line, after
    // stripping a trailing \r, to exactly `---`; the same rule now applies here,
    // so an indented fence can no longer load in the family alone.
    const indentedOpen = ' ---\nname: demo-skill\ndescription: Demo.\n---\n\n# Demo\n'
    expect(parseFrontmatter(indentedOpen)).toBeNull()
    expect(normalizeFrontmatter(indentedOpen).changed).toBe(false)
    const indentedClose = '---\nname: demo-skill\ndescription: Demo.\n ---\n\n# Demo\n'
    expect(parseFrontmatter(indentedClose)).toBeNull()
    const crlf = '---\r\nname: demo-skill\r\ndescription: Demo.\r\n---\r\n\r\n# Demo\r\n'
    expect(parseFrontmatter(crlf)?.frontmatter['name']).toBe('demo-skill')
  })

  it('a body-less file is refused by the reader but still judged by the audit', () => {
    const bodyless = '---\nname: demo-skill\ndescription: Search: arXiv papers\n---\n'
    expect(parseFrontmatter(bodyless)).toBeNull()
    expect(frontmatterCatalogInvalid(bodyless)).toBe(true)
  })
})

describe('v28 G2.2 (CORE-SK-01): YAML 1.2 core number forms are quoted, not split-brained', () => {
  it('flags hex/octal/exponent/inf/nan scalars the strict parser coerces', () => {
    expect(yamlPlainScalarNeedsQuotes('0x1F')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('0o17')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('1e5')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('1.5E-3')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('.inf')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('.NaN')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('1.')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('.5')).toBe(true)
  })

  it('a file whose description is a hex scalar is catalogInvalid and self-heals on rewrite', () => {
    const raw = '---\nname: hex-skill\ndescription: 0x1F\n---\n\n# Hex\n'
    expect(frontmatterCatalogInvalid(raw)).toBe(true)
    const result = normalizeFrontmatter(raw)
    expect(result.changed).toBe(true)
    expect(frontmatterCatalogInvalid(result.content)).toBe(false)
  })

  it('plain decimals and prose stay unflagged', () => {
    expect(yamlPlainScalarNeedsQuotes('31')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('-2.5')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('Version 0x1F compatible')).toBe(false)
    expect(yamlPlainScalarNeedsQuotes('info@0x10')).toBe(false)
  })
})

describe('v28 G2.3 (CORE-SK-02): undetectable frontmatter blocks fail closed', () => {
  it('a BOM-prefixed fence is catalogInvalid (the platform may still parse it)', () => {
    const bom = '\uFEFF---\nname: bom-skill\ndescription: Demo.\n---\n\n# Demo\n'
    expect(frontmatterCatalogInvalid(bom)).toBe(true)
  })

  it('mixed line endings are catalogInvalid', () => {
    const mixed = '---\r\nname: mixed-skill\ndescription: Demo.\n---\n\n# Demo\n'
    expect(frontmatterCatalogInvalid(mixed)).toBe(true)
  })

  it('a body-only file and an unterminated block stay "not applicable" (structure health owns them)', () => {
    expect(frontmatterCatalogInvalid('---\n\n# Just a rule and body\n')).toBe(false)
    expect(frontmatterCatalogInvalid('# Plain body\n')).toBe(false)
  })
})
