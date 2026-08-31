import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

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
