import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

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
  await rm(root, { recursive: true, force: true })
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
  await rm(root, { recursive: true, force: true })
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
  await rm(root, { recursive: true, force: true })
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
  await rm(root, { recursive: true, force: true })
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
  await rm(root, { recursive: true, force: true })
})

async function nodeExists(path: string): Promise<boolean> {
  const { access } = await import('node:fs/promises')
  return access(path).then(() => true, () => false)
}
