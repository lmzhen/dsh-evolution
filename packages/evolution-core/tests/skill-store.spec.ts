import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

const SKILL = `---
name: python-testing
description: Run and debug Python tests.
---

# Python Testing

Run tests with pytest.
`

it('skill create/update/patch/archive are recoverable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  const created = await lib.create('python-testing', SKILL, 'background_review')
  expect(created.ok).toBe(true)
  expect((await lib.list()).some(s => s.name === 'python-testing')).toBe(true)
  expect(await lib.isManaged('python-testing')).toBe(true)

  const patched = await lib.patch('python-testing', 'Run tests with pytest.', 'Run tests with `pytest -q`.')
  expect(patched.ok).toBe(true)
  expect(await lib.read('python-testing') ?? '').toMatch(/pytest -q/)

  const archived = await lib.archive('python-testing')
  expect(archived.ok).toBe(true)
  expect((await lib.list()).some(s => s.name === 'python-testing')).toBe(false)
  await rm(root, { recursive: true, force: true })
})

it('skill protection and path traversal guards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('safe-skill', SKILL.replace('python-testing', 'safe-skill'), 'foreground')
  await writeFile(join(root, 'safe-skill', '.pinned'), '', 'utf8')
  expect((await lib.update('safe-skill', SKILL.replace('python-testing', 'safe-skill'))).ok).toBe(true)
  expect((await lib.archive('safe-skill')).ok).toBe(false)
  expect((await lib.writeSupportFile('safe-skill', '../evil.md', 'bad')).ok).toBe(false)
  await rm(root, { recursive: true, force: true })
})

const USABLE = (name: string) => `---
name: ${name}
description: A usable skill for consolidation tests.
---

# ${name}

Body of ${name}.
`

it('skill consolidate merges sources into target and archives them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('target-skill', USABLE('target-skill'), 'foreground')
  await lib.create('src-a', USABLE('src-a'), 'foreground')
  await lib.create('src-b', USABLE('src-b'), 'foreground')
  const result = await lib.consolidate('target-skill', ['src-a', 'src-b'])
  expect(result.ok).toBe(true)
  const merged = await lib.read('target-skill') ?? ''
  expect(merged).toMatch(/consolidated from src-a/)
  expect(merged).toMatch(/consolidated from src-b/)
  // Sources are archived out of the active root and recoverable.
  expect((await lib.list()).some(s => s.name === 'src-a')).toBe(false)
  expect((await lib.list()).some(s => s.name === 'src-b')).toBe(false)
  // And can be restored without clobbering the now-merged target.
  const restored = await lib.restoreFromArchive('src-a')
  expect(restored.ok).toBe(true)
  await rm(root, { recursive: true, force: true })
})

it('skill consolidate is atomic: a protected source aborts before any mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('target-skill', USABLE('target-skill'), 'foreground')
  await lib.create('src-a', USABLE('src-a'), 'foreground')
  await lib.create('src-pinned', USABLE('src-pinned'), 'foreground')
  await writeFile(join(root, 'src-pinned', '.pinned'), '', 'utf8')
  const result = await lib.consolidate('target-skill', ['src-a', 'src-pinned'])
  expect(result.ok).toBe(false)
  // The merge must NOT have landed; the target keeps its original body.
  const target = await lib.read('target-skill') ?? ''
  expect(target).not.toMatch(/consolidated from/)
  // No source may have been consumed (src-a untouched, src-pinned protected).
  expect((await lib.list()).some(s => s.name === 'src-a')).toBe(true)
  expect((await lib.list()).some(s => s.name === 'src-pinned')).toBe(true)
  await rm(root, { recursive: true, force: true })
})

it('archive options: a reason string is never validated as absorbedInto (F1 regression)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('stale-skill', USABLE('stale-skill'), 'background_review')
  // rc.12 bug: the curator passed 'Lifecycle: reached archive threshold' as the
  // absorbed-into skill name, so every auto-archive failed with
  // 'absorbed_into="Lifecycle: ..." does not exist'. A reason never validates.
  const archived = await lib.archive('stale-skill', { reason: 'Lifecycle: reached archive threshold' })
  expect(archived.ok).toBe(true)
  // Absorbed-into validation still applies on consolidation semantics.
  await lib.restoreFromArchive('stale-skill')
  const absorbed = await lib.archive('stale-skill', { absorbedInto: 'no-such-umbrella' })
  expect(absorbed.ok).toBe(false)
  expect(absorbed.message).toMatch(/absorbed_into/)
  await rm(root, { recursive: true, force: true })
})

it('pinned skills are read-only to the background review but writable in the foreground', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('pinned-skill', USABLE('pinned-skill'), 'foreground')
  await writeFile(join(root, 'pinned-skill', '.pinned'), '', 'utf8')
  expect((await lib.update('pinned-skill', USABLE('pinned-skill'), 'background_review')).ok).toBe(false)
  expect((await lib.patch('pinned-skill', 'Body of pinned-skill.', 'Post-review body.', '', false, 'background_review')).ok).toBe(false)
  expect((await lib.writeSupportFile('pinned-skill', 'references/detail.md', '# Detail', 'background_review')).ok).toBe(false)
  // Foreground (user-directed) writes stay allowed: pin blocks the lifecycle,
  // not user improvements.
  expect((await lib.patch('pinned-skill', 'Body of pinned-skill.', 'Foreground body.')).ok).toBe(true)
  expect((await lib.writeSupportFile('pinned-skill', 'references/detail.md', '# Detail')).ok).toBe(true)
  await rm(root, { recursive: true, force: true })
})

it('bundled detection and allowBundled archival (F8 prune-builtins precondition)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('builtin-skill', USABLE('builtin-skill'), 'foreground')
  await writeFile(join(root, 'builtin-skill', '.bundled'), '', 'utf8')
  await lib.create('hub-skill', USABLE('hub-skill'), 'foreground')
  await writeFile(join(root, 'hub-skill', '.hub-installed'), '', 'utf8')
  expect(await lib.isBundled('builtin-skill')).toBe(true)
  expect(await lib.isBundled('hub-skill')).toBe(false)
  expect((await lib.archive('builtin-skill')).ok).toBe(false)
  expect((await lib.archive('builtin-skill', { allowBundled: true })).ok).toBe(true)
  // Hub-installed stays protected even with allowBundled (only bundled yields).
  expect((await lib.archive('hub-skill', { allowBundled: true })).ok).toBe(false)
  await rm(root, { recursive: true, force: true })
})
