import { expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFrontmatter, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

const BODY = `---
name: demo-skill
description: demonstrate restructure.
---

# Demo

Intro line.

## Details log

- rc.67 fixed X
- abc1234 more detail

## Usage

Use it with care.
`

function makeLib(): Promise<{ root: string; lib: SkillLibrary }> {
  return mkdtemp(join(tmpdir(), 'dsh-evo-restructure-')).then(async (root) => {
    const lib = new SkillLibrary(root)
    await lib.create('demo-skill', BODY, 'foreground')
    return { root, lib }
  })
}

it('moves a body section to references/ and replaces it with a pointer line (B)', async () => {
  const { root, lib } = await makeLib()
  const result = await lib.restructure('demo-skill', [{ heading: 'Details log', toFile: 'references/release-log.md' }], 'background_review')
  expect(result.ok).toBe(true)
  const md = await lib.read('demo-skill')
  expect(md ?? '').toContain('> 详见 references/release-log.md')
  expect(md ?? '').not.toContain('rc.67')
  expect(md ?? '').toContain('## Usage')
  expect(md ?? '').toContain('name: demo-skill')
  const moved = await readFile(join(root, 'demo-skill', 'references', 'release-log.md'), 'utf8').catch(() => '')
  expect(moved.includes('## Details log')).toBe(true)
  expect(moved.includes('rc.67')).toBe(true)
  await rm(root, { recursive: true, force: true })
})

it('appends to an existing references file and keeps the skill readable', async () => {
  const { root, lib } = await makeLib()
  await lib.writeSupportFile('demo-skill', 'references/notes.md', '# existing notes', 'foreground')
  const result = await lib.restructure('demo-skill', [{ heading: 'Details log', toFile: 'references/notes.md' }], 'background_review')
  expect(result.ok).toBe(true)
  const notes = await readFile(join(root, 'demo-skill', 'references', 'notes.md'), 'utf8').catch(() => '')
  expect(notes).toContain('# existing notes')
  expect(notes.indexOf('# existing notes')).toBeLessThan(notes.indexOf('## Details log'))
  await rm(root, { recursive: true, force: true })
})

it('orders two moves into one file by move order', async () => {
  const { root, lib } = await makeLib()
  const result = await lib.restructure('demo-skill', [
    { heading: 'Details log', toFile: 'references/log.md' },
    { heading: 'Usage', toFile: 'references/log.md' },
  ], 'background_review')
  expect(result.ok).toBe(true)
  const moved = await readFile(join(root, 'demo-skill', 'references', 'log.md'), 'utf8').catch(() => '')
  expect(moved.indexOf('## Details log')).toBeLessThan(moved.indexOf('## Usage'))
  await rm(root, { recursive: true, force: true })
})

it('rejects an unknown heading with zero writes', async () => {
  const { root, lib } = await makeLib()
  const result = await lib.restructure('demo-skill', [{ heading: 'No such section', toFile: 'references/x.md' }], 'background_review')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('no "## No such section" heading')
  expect(await lib.read('demo-skill')).toBe(BODY)
  const entries = await readFile(join(root, 'demo-skill', 'references'), { encoding: 'utf8' }).then(
    () => 'present',
    () => 'absent',
  )
  expect(entries).toBe('absent')
  await rm(root, { recursive: true, force: true })
})

it('rejects duplicate, empty and out-of-domain moves', async () => {
  const { root, lib } = await makeLib()
  const duplicate = await lib.restructure('demo-skill', [
    { heading: 'Usage', toFile: 'references/a.md' },
    { heading: 'Usage', toFile: 'references/b.md' },
  ], 'background_review')
  expect(duplicate.ok).toBe(false)
  expect(duplicate.message).toContain('moved twice')
  await lib.create('empty-skill', `---
name: empty-skill
description: empty section fixture.
---

## OnlyEmpty
## Usage

Use it.
`, 'foreground')
  const empty = await lib.restructure('empty-skill', [{ heading: 'OnlyEmpty', toFile: 'references/x.md' }], 'background_review')
  expect(empty.ok).toBe(false)
  expect(empty.message).toContain('empty section')
  const wrongKind = await lib.restructure('demo-skill', [{ heading: 'Usage', toFile: 'templates/x.md' }], 'background_review')
  expect(wrongKind.ok).toBe(false)
  const traversal = await lib.restructure('demo-skill', [{ heading: 'Usage', toFile: '../x.md' }], 'background_review')
  expect(traversal.ok).toBe(false)
  const subdir = await lib.restructure('demo-skill', [{ heading: 'Usage', toFile: 'references/sub/x.md' }], 'background_review')
  expect(subdir.ok).toBe(false)
  expect(await lib.read('demo-skill')).toBe(BODY)
  await rm(root, { recursive: true, force: true })
})

it('moves deeper headings with their parent section', async () => {
  const { root, lib } = await makeLib()
  await lib.create('deeper-skill', `---
name: deeper-skill
description: deeper fixture.
---

## Base

Intro.

## Logs

- rc.68 note

### Sub nuance

Nuance detail.

## Trim

Elsewhere.
`, 'foreground')
  const result = await lib.restructure('deeper-skill', [{ heading: 'Logs', toFile: 'references/logs.md' }], 'background_review')
  expect(result.ok).toBe(true)
  const md = await lib.read('deeper-skill')
  expect(md ?? '').toContain('> 详见 references/logs.md')
  expect(md ?? '').toContain('## Trim')
  expect(md ?? '').not.toContain('rc.68')
  const moved = await readFile(join(root, 'deeper-skill', 'references', 'logs.md'), 'utf8').catch(() => '')
  expect(moved).toContain('### Sub nuance')
  expect(moved).toContain('Nuance detail.')
  await rm(root, { recursive: true, force: true })
})

it('refuses pinned skills from the background review (origin gate)', async () => {
  const { root, lib } = await makeLib()
  await lib.setPinned('demo-skill', true, 'foreground')
  const result = await lib.restructure('demo-skill', [{ heading: 'Details log', toFile: 'references/x.md' }], 'background_review')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('protected')
  expect(await lib.read('demo-skill')).toBe(BODY)
  await rm(root, { recursive: true, force: true })
})

it('a `----` line inside frontmatter does not truncate the header (E-38, 0.3.16)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-restructure-'))
  const lib = new SkillLibrary(root)
  const dodge = `---
name: demo-skill
description: demonstrate restructure.
----
---

# Demo

Intro.

## Details log

- rc.67 fixed X
`
  await lib.create('demo-skill', dodge, 'foreground')
  const result = await lib.restructure('demo-skill', [{ heading: 'Details log', toFile: 'references/log.md' }], 'background_review')
  expect(result.ok).toBe(true)
  const md = await lib.read('demo-skill') ?? ''
  expect(md).toContain('name: demo-skill')
  // The `----` line stayed inside the frontmatter block; the body starts at
  // the real `---` closer (the old indexOf cut the header on the 4-dash line).
  expect(md.slice(0, md.indexOf('# Demo'))).toContain('----')
  expect(md).toContain('> 详见 references')
  await rm(root, { recursive: true, force: true })
})

it('keeps CRLF line endings on every untouched line (E-38a, 0.3.16)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-restructure-'))
  const lib = new SkillLibrary(root)
  // Write the CRLF file directly: create() assembles content with LF.
  await mkdir(join(root, 'crlf-skill'), { recursive: true })
  await writeFile(join(root, 'crlf-skill', 'SKILL.md'), BODY.replaceAll('demo-skill', 'crlf-skill').replace(/\n/g, '\r\n'), 'utf8')
  const result = await lib.restructure('crlf-skill', [{ heading: 'Details log', toFile: 'references/log.md' }], 'background_review')
  expect(result.ok).toBe(true)
  const raw = await readFile(join(root, 'crlf-skill', 'SKILL.md'), 'utf8')
  expect(raw.includes('\r\n')).toBe(true)
  // No lone LF remains: untouched lines kept their original ending.
  expect(raw.replace(/\r\n/g, '').includes('\n')).toBe(false)
  await rm(root, { recursive: true, force: true })
})

it('never duplicates frontmatter on success or on repeated restructures (v7 audit P1-1)', async () => {
  const { root, lib } = await makeLib()
  const first = await lib.restructure('demo-skill', [{ heading: 'Details log', toFile: 'references/log.md' }], 'background_review')
  expect(first.ok).toBe(true)
  const md = await lib.read('demo-skill')
  // Structure-level assertion: `toContain` cannot see a duplicated frontmatter
  // block, but the parse body must never START with `---`.
  const parsed = parseFrontmatter(md ?? '')
  expect(parsed).not.toBeNull()
  expect(parsed?.body.startsWith('---')).toBe(false)
  await lib.restructure('demo-skill', [{ heading: 'Usage', toFile: 'references/use.md' }], 'background_review')
  const md2 = await lib.read('demo-skill')
  const parsed2 = parseFrontmatter(md2 ?? '')
  expect(parsed2?.body.startsWith('---')).toBe(false)
  expect(parsed2?.frontmatter.name).toBe('demo-skill')
  expect(md2 ?? '').toContain('> 详见 references/log.md')
  expect(md2 ?? '').toContain('> 详见 references/use.md')
  await rm(root, { recursive: true, force: true })
})
