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

it('setPinned writes the marker, audits it, and refuses the background review', async () => {  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-pin-'))
  const lib = new SkillLibrary(root)
  await lib.create('pin-target', SKILL.replace('python-testing', 'pin-target'), 'background_review')
  const pinned = await lib.setPinned('pin-target', true, 'foreground')
  expect(pinned.ok).toBe(true)
  expect(await lib.isPinned('pin-target')).toBe(true)
  // Enforcement: background writes rejected, foreground writes still allowed.
  expect((await lib.update('pin-target', SKILL.replace('python-testing', 'pin-target'), 'background_review')).ok).toBe(false)
  expect((await lib.update('pin-target', SKILL.replace('python-testing', 'pin-target'), 'foreground')).ok).toBe(true)
  // The autonomous pipeline may never pin/unpin (self-freezing would escape the lifecycle).
  expect((await lib.setPinned('pin-target', false, 'background_review')).ok).toBe(false)
  // Idempotency + audit trail + clean unpin.
  expect((await lib.setPinned('pin-target', true, 'foreground')).message).toContain('already pinned')
  const mutations = await lib.listMutations()
  expect(mutations.some(m => m.action === 'pin' && m.skillName === 'pin-target')).toBe(true)
  const unpinned = await lib.setPinned('pin-target', false, 'foreground')
  expect(unpinned.ok).toBe(true)
  expect(await lib.isPinned('pin-target')).toBe(false)
  await rm(root, { recursive: true, force: true })
})

it('invalid skill names cannot escape the skills root (path traversal guard)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-traversal-'))
  const lib = new SkillLibrary(root)
  await lib.create('safe-skill', SKILL.replace('python-testing', 'safe-skill'), 'background_review')
  const evil = '../outside'
  expect((await lib.update(evil, SKILL, 'foreground')).ok).toBe(false)
  expect((await lib.patch(evil, 'x', 'y')).ok).toBe(false)
  expect((await lib.archive(evil)).ok).toBe(false)
  expect((await lib.writeSupportFile(evil, 'references/a.md', '# x')).ok).toBe(false)
  expect((await lib.removeSupportFile(evil, 'references/a.md')).ok).toBe(false)
  expect(await lib.read('../outside')).toBeNull()
  expect(await lib.isPinned(evil)).toBe(false)
  expect(await lib.isBundled(evil)).toBe(false)
  expect(await lib.countSupportDirs(evil)).toBe(0)
  await rm(root, { recursive: true, force: true })
  await rm(join(root, '..', 'outside'), { recursive: true, force: true })
})

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

it('fuzzy patch tolerates whitespace drift without rewriting surrounding bytes (D8 re-check)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('ws-skill', '---\nname: ws-skill\ndescription: whitespace drift test\n---\n\nRun tests with  double  spaces.\nIndented    columns stay.\n', 'foreground')
  // The model cites a line whose spacing collapsed to single spaces; the
  // patch lands on the real span and every untouched byte (including the
  // double spaces elsewhere and the later line) survives verbatim.
  const patched = await lib.patch('ws-skill', 'Run tests with double spaces.', 'Run tests with double spaces. (fixed)')
  expect(patched.ok).toBe(true)
  const content = await lib.read('ws-skill') ?? ''
  expect(content).toContain('Indented    columns stay.')
  expect(content).toContain('Run tests with double spaces. (fixed)')
  // A genuinely different target must reject cleanly instead of corrupting.
  expect((await lib.patch('ws-skill', 'Totally different text', 'x')).ok).toBe(false)
  // Boundary trim: the model cites the line with its leading indent included;
  // the span lands on the real text and other bytes survive.
  const boundary = await lib.patch('ws-skill', '  Run tests with double spaces. (fixed)', '  Run tests with double spaces. (final)')
  expect(boundary.ok).toBe(true)
  expect(await lib.read('ws-skill') ?? '').toContain('Indented    columns stay.')
  // Escape literals: pattern cites real newlines as \n — matches and replaces
  // only the quoted span.
  const escaped = await lib.patch('ws-skill', 'Run tests with double spaces. (final)\nIndented    columns stay.', 'Run tests with double spaces. (final)\nIndented    columns changed.')
  expect(escaped.ok).toBe(true)
  expect(await lib.read('ws-skill') ?? '').toContain('Indented    columns changed.')
  await rm(root, { recursive: true, force: true })
})
