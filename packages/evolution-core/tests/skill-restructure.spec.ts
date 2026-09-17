import { expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SKILL_LIMITS, isPresent, missingSupportPointers, parseFrontmatter, SkillLibrary, validateRestructureTarget } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const withCitation = (target: string): string => BODY.replace('Use it with care.', 'See ' + target + ' for the details.')

it('A3 (design §2.2): a section citing an EXISTING support file moves under the default policy', async () => {
  const { root, lib } = await makeLib()
  await lib.writeSupportFile('demo-skill', 'references/guide.md', '# guide', 'foreground')
  await lib.update('demo-skill', withCitation('references/guide.md'), 'foreground')
  const result = await lib.restructure('demo-skill', [{ heading: 'Usage', toFile: 'references/usage.md' }], 'background_review')
  expect(result.ok).toBe(true)
  const moved = await readFile(join(root, 'demo-skill', 'references', 'usage.md'), 'utf8').catch(() => '')
  expect(moved).toContain('references/guide.md')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('A3: a section citing a MISSING support file is refused, with the target named', async () => {
  const { root, lib } = await makeLib()
  await lib.writeSupportFile('demo-skill', 'references/other.md', '# other', 'foreground')
  await lib.update('demo-skill', withCitation('references/absent.md'), 'foreground')
  const result = await lib.restructure('demo-skill', [{ heading: 'Usage', toFile: 'references/usage.md' }], 'background_review')
  expect(result.ok).toBe(false)
  const message = (result as { message?: string }).message ?? ''
  expect(message).toContain('do not exist')
  expect(message).toContain('references/absent.md')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('A3: citationPolicy refuse restores the conservative refusal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-restructure-'))
  const lib = new SkillLibrary(root, undefined, { ...DEFAULT_SKILL_LIMITS, citationPolicy: 'refuse' })
  await lib.create('demo-skill', withCitation('references/guide.md'), 'foreground')
  await lib.writeSupportFile('demo-skill', 'references/guide.md', '# guide', 'foreground')
  const result = await lib.restructure('demo-skill', [{ heading: 'Usage', toFile: 'references/usage.md' }], 'background_review')
  expect(result.ok).toBe(false)
  expect(((result as { message?: string }).message ?? '')).toContain('that stay behind')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('appends to an existing references file and keeps the skill readable', async () => {
  const { root, lib } = await makeLib()
  await lib.writeSupportFile('demo-skill', 'references/notes.md', '# existing notes', 'foreground')
  const result = await lib.restructure('demo-skill', [{ heading: 'Details log', toFile: 'references/notes.md' }], 'background_review')
  expect(result.ok).toBe(true)
  const notes = await readFile(join(root, 'demo-skill', 'references', 'notes.md'), 'utf8').catch(() => '')
  expect(notes).toContain('# existing notes')
  expect(notes.indexOf('# existing notes')).toBeLessThan(notes.indexOf('## Details log'))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('refuses pinned skills from the background review (origin gate)', async () => {
  const { root, lib } = await makeLib()
  await lib.setPinned('demo-skill', true, 'foreground')
  const result = await lib.restructure('demo-skill', [{ heading: 'Details log', toFile: 'references/x.md' }], 'background_review')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('protected')
  expect(await lib.read('demo-skill')).toBe(BODY)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('a `----` line inside frontmatter does not truncate the header (E-38, 0.3.16)', async () => {
  const root = await tempRoot('dsh-evo-restructure-')
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
})

it('keeps CRLF line endings on every untouched line (E-38a, 0.3.16)', async () => {
  const root = await tempRoot('dsh-evo-restructure-')
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

// V3: a moved section's citations travel one hop deeper, so the body keeps a pure
// LINK LIST of them — otherwise `pointer_missing` (body-level) reports files that
// are perfectly reachable through the new reference file. Measured on the live
// skill: without this line, moving 验证手法 took missing 0 -> 8.
it('V3: the pointer block carries the moved section citations so the body still points at them', async () => {
  const { root, lib } = await makeLib()
  await lib.writeSupportFile('demo-skill', 'references/known-limitations.md', '# limits', 'foreground')
  await lib.writeSupportFile('demo-skill', 'scripts/probe.mjs', '// probe', 'foreground')
  const withRefs = BODY.replace('Use it with care.', 'See references/known-limitations.md and scripts/probe.mjs, then references/guide.md.')
  await lib.update('demo-skill', withRefs, 'foreground')
  const moved = await lib.restructure('demo-skill', [{ heading: 'Usage', toFile: 'references/usage-playbook.md' }], 'foreground')
  expect(moved.ok, moved.message).toBe(true)
  const md = (await lib.read('demo-skill')) ?? ''
  expect(md).toContain('> 详见 references/usage-playbook.md')
  expect(md).toContain('> 本节引用：references/known-limitations.md · scripts/probe.mjs')
  // The invariant the line buys: those files stay POINTED AT from the body.
  const listed = await lib.listSupportFiles('demo-skill')
  const files = isPresent(listed) ? listed.value : []
  expect(missingSupportPointers(md, files)).toEqual([])
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

// Step 5's naming rule (design §2.7) closed as a MEASURED property instead of an
// invented style rule: a 190-case corpus over the real library
// (audit-v42/naming-rule-corpus.mjs) found ZERO targets that restructure accepts
// and the write path refuses, so a moved section can never create a support file
// that the later write/patch/remove paths would reject as an orphan (the A1-6
// rationale). 55 targets go the other way — restructure is deliberately stricter
// (references/*.md only) — which this test leaves untouched.
it('the restructure target rule is at least as strict as the write path (no orphans)', async () => {
  const { root, lib } = await makeLib()
  const targets = [
    'references/ok.md',
    'references/a/b.md',
    'references/x.txt',
    'references/x',
    'references//x.md',
    'references/x.lock',
    'references/x.corrupt',
    'references/x.tmp',
    'references/nul.md',
    'references/../evil.md',
    'references/Sub.md',
    'templates/x.tmpl',
    'references/.hidden.md',
  ]
  for (const target of targets) {
    if (validateRestructureTarget(target) !== null) continue
    const written = await lib.writeSupportFile('demo-skill', target, '# probe', 'foreground')
    expect(written.ok, target + ' is accepted by restructure but refused by the write path').toBe(true)
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

