import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SKILL_LIMITS, isPresent, nodeEvolutionIo, resolveCitations, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

const body = (name: string) => `---
name: ${name}
description: ${name} body
---

Body of ${name}.
`

function make(): Promise<{ root: string; lib: SkillLibrary }> {
  return mkdtemp(join(tmpdir(), 'dsh-evo-consolidate-')).then(async (root) => {
    const lib = new SkillLibrary(root)
    await lib.create('umbrella', body('umbrella'), 'foreground')
    await lib.create('narrow-a', body('narrow-a'), 'foreground')
    await lib.create('narrow-b', body('narrow-b'), 'foreground')
    return { root, lib }
  })
}

it('append mode merges bodies and archives sources with absorbed-into (append default, kernel path)', async () => {
  const { root, lib } = await make()
  const result = await lib.consolidate('umbrella', ['narrow-a', 'narrow-b'], 'background_review')
  expect(result.ok).toBe(true)
  const md = await lib.read('umbrella')
  expect(md ?? '').toContain('Body of narrow-a.')
  expect(md ?? '').toContain('Body of narrow-b.')
  expect(await lib.read('narrow-a')).toBeNull()
  expect(await lib.read('narrow-b')).toBeNull()
  expect(await nodeExists(join(root, '.archive', 'narrow-a'))).toBe(true)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('append mode refuses a source with support files — zero side effects (009-I)', async () => {
  const { root, lib } = await make()
  await lib.writeSupportFile('narrow-a', 'references/notes.md', '# notes', 'foreground')
  const before = await lib.read('umbrella')
  const result = await lib.consolidate('umbrella', ['narrow-a'], 'background_review')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('mode:\'reference\'')
  expect(await lib.read('umbrella')).toBe(before)
  expect(await lib.read('narrow-a')).not.toBeNull()
  expect(await nodeExists(join(root, '.archive', 'narrow-a'))).toBe(false)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('append mode refuses a source whose body links its own support files (009-I)', async () => {
  const { root, lib } = await make()
  await lib.update('narrow-b', `---
name: narrow-b
description: linked body
---

# Narrow B

See references/details.md for the rest.
`, 'foreground')
  const result = await lib.consolidate('umbrella', ['narrow-b'], 'background_review')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('references/details.md')
  expect(await lib.read('narrow-b')).not.toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('integrity refuses non-md and nested support links too (v7 audit P3-1)', async () => {
  const { root, lib } = await make()
  await lib.update('narrow-a', `---
name: narrow-a
description: non-md links
---

# Narrow A

Run scripts/run.sh and see references/sub/x.md for details.
`, 'foreground')
  const result = await lib.consolidate('umbrella', ['narrow-a'], 'background_review')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('scripts/run.sh')
  expect(result.message).toContain('references/sub/x.md')
  expect(await lib.read('narrow-a')).not.toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('reference mode demotes a source into umbrella references/ and adds a pointer line (009-II)', async () => {
  const { root, lib } = await make()
  const result = await lib.consolidate('umbrella', ['narrow-a'], 'background_review', { mode: 'reference' })
  expect(result.ok).toBe(true)
  const demoted = await readFile(join(root, 'umbrella', 'references', 'narrow-a.md'), 'utf8').catch(() => '')
  expect(demoted).toContain('Body of narrow-a.')
  expect(await lib.read('umbrella')).not.toBeNull()
  expect((await lib.read('umbrella')) ?? '').toContain('> 详见 references/narrow-a.md')
  expect(await lib.read('narrow-a')).toBeNull()
  expect(await nodeExists(join(root, '.archive', 'narrow-a'))).toBe(true)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('reference mode refuses a source whose body links support files (dangling demote)', async () => {
  const { root, lib } = await make()
  await lib.update('narrow-a', `---
name: narrow-a
description: linked source
---

# Narrow A

See templates/tpl.md for the template.
`, 'foreground')
  const result = await lib.consolidate('umbrella', ['narrow-a'], 'background_review', { mode: 'reference' })
  expect(result.ok).toBe(false)
  expect(result.message).toContain('templates/tpl.md')
  expect(await lib.read('narrow-a')).not.toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V10-01 (P2-2): reference mode APPENDS to an existing demotion file — two consolidates never lose the first content', async () => {  const { root, lib } = await make()
  expect((await lib.consolidate('umbrella', ['narrow-a'], 'background_review', { mode: 'reference' })).ok).toBe(true)
  // The rebuild half of "consolidate → rebuild → re-consolidate": the source
  // comes back (same name), the old demotion file is still in references/.
  await lib.create('narrow-a', body('narrow-a'), 'foreground')
  expect((await lib.consolidate('umbrella', ['narrow-a'], 'background_review', { mode: 'reference' })).ok).toBe(true)
  const demoted = await readFile(join(root, 'umbrella', 'references', 'narrow-a.md'), 'utf8').catch(() => '')
  // The FIRST demotion's bytes survive the second one (the old overwrite
  // silently cleared them, leaving exactly one demotion comment).
  expect(demoted.match(/<!-- demoted from narrow-a at /g)?.length).toBe(2)
  expect(demoted).toContain('Body of narrow-a.')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('S1-E1: a merge that fails validation AFTER the sources were archived rolls every source back', async () => {
  // The two-phase commit used to `return` on the post-archive validation
  // failure, which skips the catch's rollback — every source stayed in
  // .archive while the message implied the merge had merely been refused.
  const { root, lib } = await make()
  // Each source is individually valid (~55k chars) but the merged body
  // (umbrella + both) exceeds MAX_SKILL_CONTENT_CHARS (100_000).
  const fat = (name: string) => `---\nname: ${name}\ndescription: ${name} fat body\n---\n\n${'x'.repeat(55_000)}\n`
  await lib.update('narrow-a', fat('narrow-a'), 'foreground')
  await lib.update('narrow-b', fat('narrow-b'), 'foreground')
  const result = await lib.consolidate('umbrella', ['narrow-a', 'narrow-b'], 'background_review')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('exceeds')
  expect(result.message).toContain('rolled back')
  // Both sources are back in the live tree and OUT of .archive.
  expect(await lib.read('narrow-a')).not.toBeNull()
  expect(await lib.read('narrow-b')).not.toBeNull()
  expect(await lib.read('narrow-a')).toContain('x'.repeat(1000))
  expect(await nodeExists(join(root, '.archive', 'narrow-a'))).toBe(false)
  expect(await nodeExists(join(root, '.archive', 'narrow-b'))).toBe(false)
  // The umbrella itself is untouched.
  expect(await lib.read('umbrella')).toBe(body('umbrella'))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V1: a source carrying support files is refused WITH the re-home plan (default policy plan)', async () => {
  const { root, lib } = await make()
  await lib.writeSupportFile('narrow-a', 'references/guide.md', '# guide\n', 'foreground')
  await lib.update('narrow-a', `${body('narrow-a')}\nSee references/guide.md for the detail.\n`, 'foreground')
  const refused = await lib.consolidate('umbrella', ['narrow-a'], 'foreground')
  expect(refused.ok).toBe(false)
  expect(refused.message).toContain('carries support files')
  expect(refused.message).toContain('plan: re-home 1 file(s)')
  expect(refused.message).toContain('rewrite 0 reference(s)')
  expect(refused.message).toContain('residual dangling 0')
  // A refusal writes and archives nothing.
  expect(await lib.read('narrow-a')).not.toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V1: a colliding support path is renamed in the plan and its body edit is counted', async () => {
  const { root, lib } = await make()
  await lib.writeSupportFile('umbrella', 'references/guide.md', '# umbrella guide\n', 'foreground')
  await lib.writeSupportFile('narrow-a', 'references/guide.md', '# narrow guide\n', 'foreground')
  await lib.update('narrow-a', `${body('narrow-a')}\nSee references/guide.md for the detail.\n`, 'foreground')
  const refused = await lib.consolidate('umbrella', ['narrow-a'], 'foreground')
  expect(refused.ok).toBe(false)
  expect(refused.message).toContain('references/narrow-a-guide.md')
  expect(refused.message).toContain('rewrite 1 reference(s)')
  expect(refused.message).toContain('collisions: references/guide.md')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V1: referenceRewrite=off keeps the refusal message exactly as it was', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-consolidate-off-'))
  const lib = new SkillLibrary(root, nodeEvolutionIo(), { ...DEFAULT_SKILL_LIMITS, referenceRewrite: 'off' })
  await lib.create('umbrella', body('umbrella'), 'foreground')
  await lib.create('narrow-a', body('narrow-a'), 'foreground')
  await lib.writeSupportFile('narrow-a', 'references/guide.md', '# guide\n', 'foreground')
  const refused = await lib.consolidate('umbrella', ['narrow-a'], 'foreground')
  expect(refused.ok).toBe(false)
  expect(refused.message).toContain('carries support files')
  expect(refused.message).not.toContain('plan:')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** V2 (design §16.7): with referenceRewrite:'apply' the merge that used to be
 * refused now lands — its NEEDED support files are copied into the target and the
 * body's references are rewritten in the same commit, so nothing dangles. */
async function makeApply(): Promise<{ root: string; lib: SkillLibrary }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-consolidate-apply-'))
  const lib = new SkillLibrary(root, nodeEvolutionIo(), { ...DEFAULT_SKILL_LIMITS, referenceRewrite: 'apply' })
  await lib.create('umbrella', body('umbrella'), 'foreground')
  await lib.create('narrow-a', body('narrow-a'), 'foreground')
  await lib.create('narrow-b', body('narrow-b'), 'foreground')
  return { root, lib }
}

async function danglingIn(lib: SkillLibrary, name: string): Promise<string[]> {
  const listed = await lib.listSupportFiles(name)
  const content = (await lib.read(name)) ?? ''
  return resolveCitations({ content, file: 'SKILL.md', files: isPresent(listed) ? listed.value : [] }).dangling.map(ref => ref.target ?? ref.raw)
}

it('V2: apply re-homes a cited support file and rewrites nothing when the path is free', async () => {
  const { root, lib } = await makeApply()
  await lib.writeSupportFile('narrow-a', 'references/guide.md', '# narrow guide\n', 'foreground')
  await lib.update('narrow-a', `${body('narrow-a')}\nSee references/guide.md for the detail.\n`, 'foreground')
  const merged = await lib.consolidate('umbrella', ['narrow-a'], 'foreground')
  expect(merged.ok, merged.message).toBe(true)
  expect(await readFile(join(root, 'umbrella', 'references', 'guide.md'), 'utf8')).toBe('# narrow guide\n')
  expect(await lib.read('narrow-a')).toBeNull()
  expect(await danglingIn(lib, 'umbrella')).toEqual([])
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V2: apply renames a colliding path, rewrites the citation, and leaves the original untouched', async () => {
  const { root, lib } = await makeApply()
  await lib.writeSupportFile('umbrella', 'references/guide.md', '# umbrella guide\n', 'foreground')
  await lib.writeSupportFile('narrow-a', 'references/guide.md', '# narrow guide\n', 'foreground')
  await lib.update('narrow-a', `${body('narrow-a')}\nSee references/guide.md for the detail.\n`, 'foreground')
  const merged = await lib.consolidate('umbrella', ['narrow-a'], 'foreground')
  expect(merged.ok, merged.message).toBe(true)
  expect(await readFile(join(root, 'umbrella', 'references', 'guide.md'), 'utf8')).toBe('# umbrella guide\n')
  expect(await readFile(join(root, 'umbrella', 'references', 'narrow-a-guide.md'), 'utf8')).toBe('# narrow guide\n')
  expect(await lib.read('umbrella')).toContain('references/narrow-a-guide.md')
  expect(await danglingIn(lib, 'umbrella')).toEqual([])
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V2: apply still refuses when the plan cannot place a cited file, and touches nothing', async () => {
  const { root, lib } = await makeApply()
  await lib.update('narrow-a', `${body('narrow-a')}\nSee references/ghost.md for the detail.\n`, 'foreground')
  const refused = await lib.consolidate('umbrella', ['narrow-a'], 'foreground')
  expect(refused.ok).toBe(false)
  expect(refused.message).toContain('cannot apply')
  expect(refused.message).toContain('references/ghost.md')
  expect(await lib.read('narrow-a')).not.toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V2: apply works in reference mode too — the demoted body keeps working references', async () => {
  const { root, lib } = await makeApply()
  await lib.writeSupportFile('narrow-a', 'references/guide.md', '# narrow guide\n', 'foreground')
  await lib.update('narrow-a', `${body('narrow-a')}\nSee references/guide.md for the detail.\n`, 'foreground')
  const demoted = await lib.consolidate('umbrella', ['narrow-a'], 'foreground', { mode: 'reference' })
  expect(demoted.ok, demoted.message).toBe(true)
  const demotedFiles = await lib.listSupportFiles('umbrella')
  const names = isPresent(demotedFiles) ? demotedFiles.value : []
  expect(names).toContain('references/narrow-a.md')
  expect(names).toContain('references/guide.md')
  const demotedBody = await readFile(join(root, 'umbrella', 'references', 'narrow-a.md'), 'utf8')
  expect(demotedBody).toContain('references/guide.md')
  expect(await danglingIn(lib, 'umbrella')).toEqual([])
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
async function nodeExists(path: string): Promise<boolean> {
  const { access } = await import('node:fs/promises')
  return access(path).then(() => true, () => false)
}
