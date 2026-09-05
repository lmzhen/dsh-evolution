import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authoringFeedback, resolveSkillsRoot, SkillLibrary, skillsRoot, loadSuppressedNames, loadUsage, nodeEvolutionIo, relatedSkillNames, saveSuppressedNames, saveUsage } from '@deepseek-ai/dsh-evolution-core'

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

it('invalid skill names cannot escape the skills root (path traversal guard)', async () => {  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-traversal-'))
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

it('archive fallback rolls back the copied archive when the source cannot be removed (E-14, 0.3.16)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const real = nodeEvolutionIo()
  // rename always fails on this provider (cross-media), and removing the
  // ACTIVE source fails too — the old shape left the skill in both roots.
  const io = {
    ...real,
    rename: async () => { throw new Error('cross-media rename not supported') },
    remove: async (path: string) => {
      if (path.includes(root) && !path.includes('.archive')) throw new Error('EBUSY')
      return real.remove(path)
    },
  }
  const lib = new SkillLibrary(root, io)
  await lib.create('swap-skill', USABLE('swap-skill'), 'foreground')
  const result = await lib.archive('swap-skill')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('rolled back')
  expect(await lib.list().then(rows => rows.map(s => s.name))).toContain('swap-skill') // active kept
  expect(await io.exists(join(root, '.archive', 'swap-skill'))).toBe(false) // archive copy cleaned
  await rm(root, { recursive: true, force: true })
})

it('snapshot restore rolls back to the pre-rollback snapshot when the restore fails (E-13, 0.3.16)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('keep-skill', USABLE('keep-skill'), 'foreground')
  const baseline = await lib.snapshotAll('baseline')
  // Damage the restore target: its keep-skill entry is gone, so the
  // manifest-driven copy throws mid-restore (after the root was cleared).
  await rm(join(baseline, 'keep-skill'), { recursive: true, force: true })
  await lib.create('other-skill', USABLE('other-skill'), 'foreground')
  const result = await lib.restoreLatestSnapshot()
  expect(result.ok).toBe(false)
  expect(result.message).toContain('rolled back')
  const names = (await lib.list()).map(s => s.name)
  // The active root is the PRE-rollback state (both skills were present when
  // the restore ran and failed) — never a cleared tree.
  expect(names).toContain('other-skill')
  expect(names).toContain('keep-skill')
  await rm(root, { recursive: true, force: true })
})

it('consolidate rollback reports sources it could not restore instead of silently swallowing (T-14, 0.3.16)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const real = nodeEvolutionIo()
  let failTargetWrite = false
  const io = {
    ...real,
    rename: async (src: string, dst: string) => {
      if (src.split(/[\\/]/).includes('.archive')) throw new Error('restore rename blocked')
      return real.rename(src, dst)
    },
    copy: async (src: string, dst: string) => {
      // The rename-refusing provider falls back to copy+remove — block that too
      // so a restore from .archive fails outright.
      if (src.split(/[\\/]/).includes('.archive')) throw new Error('restore copy blocked')
      return real.copy(src, dst)
    },
    writeText: async (path: string, content: string) => {
      if (failTargetWrite && path.includes('target-skill')) throw new Error('target write blocked')
      return real.writeText(path, content)
    },
  }
  const lib = new SkillLibrary(root, io)
  await lib.create('target-skill', USABLE('target-skill'), 'foreground')
  await lib.create('src-a', USABLE('src-a'), 'foreground')
  failTargetWrite = true
  const result = await lib.consolidate('target-skill', ['src-a'])
  expect(result.ok).toBe(false)
  expect(result.message).toContain('EXCEPT')
  expect(result.message).toContain('src-a')
  // The failed-to-restore source is still archived — and the message says so.
  expect(await io.exists(join(root, '.archive', 'src-a'))).toBe(true)
  await rm(root, { recursive: true, force: true })
})

it('resolveSkillsRoot: config wins, empty falls through to the default (S4.1, E-30 — 0.3.18)', () => {
  expect(resolveSkillsRoot({ root: '/custom/skills' })).toBe('/custom/skills')
  expect(resolveSkillsRoot({ root: '   ' })).toBe(skillsRoot())
  expect(resolveSkillsRoot({})).toBe(skillsRoot())
})

it('restoring a skill never picks a sibling-prefixed archive (E-3, 0.3.16)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('foo', USABLE('foo'), 'foreground')
  await lib.create('foo-bar', USABLE('foo-bar'), 'foreground')
  expect((await lib.archive('foo')).ok).toBe(true)
  expect((await lib.archive('foo-bar')).ok).toBe(true)
  // Old code: `${name}-` matched foo-bar's stamp, lexical sort picked it, and
  // restoring foo handed over foo-bar's content (its own archive vanished).
  const restored = await lib.restoreFromArchive('foo')
  expect(restored.ok).toBe(true)
  const fooRead = await lib.read('foo') ?? ''
  expect(fooRead).toContain('name: foo')
  expect(fooRead).not.toContain('name: foo-bar')
  // foo-bar's archive entry survived untouched and is still restorable.
  const restoredBar = await lib.restoreFromArchive('foo-bar')
  expect(restoredBar.ok).toBe(true)
  const barRead = await lib.read('foo-bar') ?? ''
  expect(barRead).toContain('name: foo-bar')
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

it('skill consolidate rolls back earlier sources when a mid-loop archive fails (P1-1)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const real = nodeEvolutionIo()
  // The pre-loop protection guard cannot catch media/race failures INSIDE the
  // archive loop: make the second source's move fail at the IO layer after the
  // first source is already in .archive. The old `return` bypassed the
  // rollback and left src-a consumed; the fix routes the failure through the
  // two-phase catch.
  const failing = (path: string): boolean => path.replace(/\\/g, '/').endsWith('/src-b')
  const lib = new SkillLibrary(root, {
    ...real,
    rename: async (from, to) => {
      if (failing(from)) throw new Error('simulated media failure')
      await real.rename(from, to)
    },
    copy: async (from, to) => {
      if (failing(from)) throw new Error('simulated media failure')
      await real.copy(from, to)
    },
  })
  await lib.create('target-skill', USABLE('target-skill'), 'foreground')
  await lib.create('src-a', USABLE('src-a'), 'foreground')
  await lib.create('src-b', USABLE('src-b'), 'foreground')
  const result = await lib.consolidate('target-skill', ['src-a', 'src-b'])
  expect(result.ok).toBe(false)
  expect(result.message).toContain('rolled back')
  // src-a was archived by the loop and MUST be back in the active tree.
  expect((await lib.list()).map(s => s.name)).toEqual(['src-a', 'src-b', 'target-skill'])
  // The target never received the merged body.
  expect(await lib.read('target-skill') ?? '').not.toMatch(/consolidated from/)
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
  // A delegated subagent write is NOT the review channel: the pinned guard
  // only blocks background_review, so an agent-authored change still lands
  // (Hermes: the background guard applies to the review fork only).
  expect((await lib.update('pinned-skill', USABLE('pinned-skill'), 'subagent')).ok).toBe(true)
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

it('snapshot co-copies usage/suppression sidecars and restore returns them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-sidecars-'))
  const lib = new SkillLibrary(root)
  await lib.create('keeper-skill', SKILL.replace('python-testing', 'keeper-skill'), 'foreground')
  await saveUsage(root, new Map([['keeper-skill', {
    created_by: 'agent', created_at: new Date().toISOString(), use_count: 1, view_count: 0, patch_count: 0,
    last_used_at: new Date().toISOString(), last_viewed_at: null, last_patched_at: null,
    state: 'active', pinned: false, archived_at: null,
  }]]), nodeEvolutionIo())
  await saveSuppressedNames(root, new Set(['sup-skill']), nodeEvolutionIo())
  await lib.snapshotAll('pre-test')
  // Mutilate both sidecars after the snapshot.
  await saveUsage(root, new Map(), nodeEvolutionIo())
  await saveSuppressedNames(root, new Set(), nodeEvolutionIo())
  const restored = await lib.restoreLatestSnapshot()
  expect(restored.ok).toBe(true)
  expect((await loadUsage(root, nodeEvolutionIo())).get('keeper-skill')?.state).toBe('active')
  expect((await loadSuppressedNames(root, nodeEvolutionIo())).has('sup-skill')).toBe(true)
  await rm(root, { recursive: true, force: true })
})

it('snapshot co-copies .archive and restore replaces it with the snapshot state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-archive-snap-'))
  const lib = new SkillLibrary(root)
  await lib.create('keeper-skill', USABLE('keeper-skill'), 'foreground')
  await lib.create('pre-archived', USABLE('pre-archived'), 'foreground')
  await lib.archive('pre-archived')
  await lib.snapshotAll('pre-test')
  // Archive something AFTER the snapshot: the rollback must drop it again.
  await lib.archive('keeper-skill')
  const restored = await lib.restoreLatestSnapshot()
  expect(restored.ok).toBe(true)
  expect((await lib.list()).map(s => s.name)).toEqual(['keeper-skill'])
  expect(await nodeEvolutionIo().list(join(root, '.archive'))).toEqual(['pre-archived'])
  await rm(root, { recursive: true, force: true })
})

it('snapshot extras are manifest-declared and only declared names are read back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-extras-'))
  const lib = new SkillLibrary(root)
  await lib.create('keeper-skill', USABLE('keeper-skill'), 'foreground')
  const dest = await lib.snapshotAll('pre-test', [{ name: 'curator-state.json', content: '{"lastRunAt":1}' }])
  const manifest = await lib.readSnapshotManifest(dest)
  expect(manifest?.extras).toEqual(['curator-state.json'])
  // A file dropped straight into extras/ WITHOUT a manifest declaration is
  // never read back (extras are not a directory-listing surface).
  await writeFile(join(dest, 'extras', 'rogue.json'), '{"evil":true}', 'utf8')
  expect((await lib.readSnapshotExtras(dest)).map(extra => extra.name)).toEqual(['curator-state.json'])
  // Restore returns the declared extras so the caller can re-apply its state.
  await lib.archive('keeper-skill')
  const restored = await lib.restoreLatestSnapshot()
  expect(restored.ok).toBe(true)
  expect(restored.extras).toEqual([{ name: 'curator-state.json', content: '{"lastRunAt":1}' }])
  expect((await lib.list()).map(s => s.name)).toEqual(['keeper-skill'])
  await rm(root, { recursive: true, force: true })
})

it('names normalize at the path choke point so padded aliases cannot fork a skill (P2-5)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-dir-'))
  const lib = new SkillLibrary(root)
  await lib.create('spaced ', SKILL.replace('python-testing', 'spaced'), 'foreground')
  expect((await lib.list()).map(s => s.name)).toEqual(['spaced'])
  // A padded reference resolves to the same directory instead of ghosting a
  // second, whitespace-padded one.
  const updated = await lib.update(' spaced ', SKILL.replace('python-testing', 'spaced').replace('Run tests with pytest.', 'Run tests with pytest v2.'), 'foreground')
  expect(updated.ok).toBe(true)
  expect(await lib.read('spaced')).toContain('v2')
  expect((await lib.list()).map(s => s.name)).toEqual(['spaced'])
  const archived = await lib.archive(' spaced ')
  expect(archived.ok).toBe(true)
  const restored = await lib.restoreFromArchive(' spaced ')
  expect(restored.ok).toBe(true)
  expect((await lib.list()).map(s => s.name)).toEqual(['spaced'])
  await rm(root, { recursive: true, force: true })
})

it('relatedSkillNames is the single related_skills parser (G3)', () => {
  const md = (related: string) => `---
name: hub
related_skills: ${related}
---
Body.
`
  // List syntax and bare value both scan; order preserved.
  expect(relatedSkillNames(md('[alpha-skill, beta-skill]'))).toEqual(['alpha-skill', 'beta-skill'])
  expect(relatedSkillNames(md('alpha-skill'))).toEqual(['alpha-skill'])
  // Dedupe and self-exclusion: one referrer counts once per target.
  expect(relatedSkillNames(md('[hub, hub, alpha-skill, hub]'), 'hub')).toEqual(['alpha-skill'])
  // No frontmatter or no field yields no references.
  expect(relatedSkillNames('no frontmatter here')).toEqual([])
  expect(relatedSkillNames(md(''))).toEqual([])
})

it('list() reports dot-prefixed protection markers with bundled-hub-pinned precedence (N-1)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-list-'))
  const lib = new SkillLibrary(root)
  await lib.create('rep-pinned', USABLE('rep-pinned'), 'foreground')
  await lib.create('rep-hub', USABLE('rep-hub'), 'foreground')
  await lib.create('rep-bundled', USABLE('rep-bundled'), 'foreground')
  await lib.create('rep-clash', USABLE('rep-clash'), 'foreground')
  await lib.create('rep-managed', USABLE('rep-managed'), 'foreground')
  // Markers are dot-prefixed files (markerPath); list() must match the same
  // names it would probe through exists(), or every protectedBy/managed
  // report is poisoned (N-1).
  await writeFile(join(root, 'rep-pinned', '.pinned'), '', 'utf8')
  await writeFile(join(root, 'rep-hub', '.hub-installed'), '', 'utf8')
  await writeFile(join(root, 'rep-bundled', '.bundled'), '', 'utf8')
  await writeFile(join(root, 'rep-managed', '.hermes-managed'), '', 'utf8')
  // Precedence mirrors deleteProtection(): bundled > hub-installed > pinned.
  await writeFile(join(root, 'rep-clash', '.pinned'), '', 'utf8')
  await writeFile(join(root, 'rep-clash', '.hub-installed'), '', 'utf8')
  await writeFile(join(root, 'rep-clash', '.bundled'), '', 'utf8')
  const by = new Map((await lib.list()).map(s => [s.name, s]))
  expect(by.get('rep-pinned')?.protectedBy).toBe('pinned')
  expect(by.get('rep-hub')?.protectedBy).toBe('hub-installed')
  expect(by.get('rep-bundled')?.protectedBy).toBe('bundled')
  expect(by.get('rep-clash')?.protectedBy).toBe('bundled')
  expect(by.get('rep-managed')?.protectedBy).toBeNull()
  expect(by.get('rep-managed')?.managed).toBe(true)
  expect(by.get('rep-pinned')?.managed).toBe(false)
  await rm(root, { recursive: true, force: true })
})

it('same-second re-archives get unique stamped destinations (N-6)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-arc-n6-'))
  const lib = new SkillLibrary(root)
  const paths: string[] = []
  // Three create→archive rounds within one second: without the collision
  // guard the third round reuses the same stamped destination of the second.
  for (let i = 0; i < 3; i += 1) {
    await lib.create('collide-skill', USABLE('collide-skill'), 'foreground')
    const result = await lib.archive('collide-skill')
    expect(result.ok).toBe(true)
    expect(result.path).toBeDefined()
    paths.push(result.path as string)
    const md = await nodeEvolutionIo().readText(join(result.path as string, 'SKILL.md'))
    expect(md).toContain('Body of collide-skill.')
  }
  expect(new Set(paths).size).toBe(3)
  await rm(root, { recursive: true, force: true })
})

it('authoringFeedback reports the 60-char bar and colon rule without changing validation (P0)', () => {
  // Within the bar: positive line, no colon warning.
  const ok = authoringFeedback({ description: 'Run and debug Python tests.' })
  expect(ok.descriptionChars).toBe(27)
  expect(ok.over60).toBe(false)
  expect(ok.hasColon).toBe(false)
  expect(ok.lines[0]).toContain('27/60')
  // Over the bar: advisory line names the count and the Hermes standard.
  const long = authoringFeedback({ description: 'A comprehensive skill that lets the agent search arXiv for academic papers using keywords, authors, and categories.' })
  expect(long.over60).toBe(true)
  expect(long.lines[0]).toContain('exceeds the 60-char authoring bar')
  // Colon rule: flagged for double-quote wrapping.
  const colon = authoringFeedback({ description: 'Search: arXiv papers by keyword.' })
  expect(colon.hasColon).toBe(true)
  expect(colon.lines.some(line => line.includes('double quotes'))).toBe(true)
  // Absent description: zero chars, no crash.
  const missing = authoringFeedback({})
  expect(missing.descriptionChars).toBe(0)
  expect(missing.hasColon).toBe(false)
})

it('create normalizes unquoted YAML-unsafe frontmatter at the write point (0.3.11)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-norm-create-'))
  const lib = new SkillLibrary(root)
  const created = await lib.create('norm-skill', '---\nname: norm-skill\ndescription: Search: arXiv papers by keyword.\n---\n\n# Body\n', 'foreground')
  expect(created.ok).toBe(true)
  expect(created.normalizedFrontmatterFields).toEqual(['description'])
  const onDisk = await (await import('node:fs/promises')).readFile(join(root, 'norm-skill', 'SKILL.md'), 'utf8')
  expect(onDisk).toContain('description: "Search: arXiv papers by keyword."')
  await rm(root, { recursive: true, force: true })
})

it('create quotes quote/backslash values via single-quote fallback — no catch-22 (0.3.11 fix)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-norm-quote-'))
  const lib = new SkillLibrary(root)
  const content = '---\nname: norm-skill\ndescription: He said "hi" then: left\n---\n\n# Body\n'
  const created = await lib.create('norm-skill', content, 'foreground')
  expect(created.ok).toBe(true)
  expect(created.normalizedFrontmatterFields).toEqual(['description'])
  // The same file is updatable (the catch-22 regression: an inner quote must
  // not deadlock the write path).
  const updated = await lib.update('norm-skill', '---\nname: norm-skill\ndescription: He said "hi" then: left\n---\n\n# Body v2\n', 'foreground')
  expect(updated.ok).toBe(true)
  const onDisk = await (await import('node:fs/promises')).readFile(join(root, 'norm-skill', 'SKILL.md'), 'utf8')
  expect(onDisk).toContain('description: \'He said "hi" then: left\'')
  await rm(root, { recursive: true, force: true })
})

it('update and patch normalize frontmatter the same way (0.3.11)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-norm-upd-'))
  const lib = new SkillLibrary(root)
  await lib.create('norm-skill', '---\nname: norm-skill\ndescription: Run tests.\n---\n\n# Body\n', 'foreground')
  const updated = await lib.update('norm-skill', '---\nname: norm-skill\ndescription: Search: arXiv papers by keyword.\n---\n\n# Body\n', 'foreground')
  expect(updated.ok).toBe(true)
  expect(updated.normalizedFrontmatterFields).toEqual(['description'])
  const patched = await lib.patch('norm-skill', 'description: "Search: arXiv papers by keyword."', 'description: Deep search: arXiv and journals.', '')
  expect(patched.ok).toBe(true)
  expect(patched.normalizedFrontmatterFields).toEqual(['description'])
  const onDisk = await (await import('node:fs/promises')).readFile(join(root, 'norm-skill', 'SKILL.md'), 'utf8')
  expect(onDisk).toContain('description: "Deep search: arXiv and journals."')
  await rm(root, { recursive: true, force: true })
})

it('E-68: an old===new patch is a noop — no write, no audit, no mutation event (0.3.18)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-noop-'))
  const events: string[] = []
  const lib = new SkillLibrary(root, nodeEvolutionIo(), undefined, e => events.push(`${e.action}:${e.skillName}`))
  const created = await lib.create('python-testing', SKILL, 'background_review')
  expect(created.ok).toBe(true)
  events.length = 0
  const before = await lib.read('python-testing')
  const mutationsBefore = (await lib.listMutations()).length
  const noop = await lib.patch('python-testing', 'Run tests with pytest.', 'Run tests with pytest.')
  expect(noop.ok).toBe(true)
  expect(noop.noop).toBe(true)
  expect(await lib.read('python-testing')).toBe(before)
  expect((await lib.listMutations()).length).toBe(mutationsBefore)
  expect(events).toEqual([])
  await rm(root, { recursive: true, force: true })
})

it('F-318 (②): update with a byte-equivalent content is a noop — no write, no audit (E-68)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-upd-noop-'))
  const lib = new SkillLibrary(root)
  const created = await lib.create('python-testing', SKILL, 'background_review')
  expect(created.ok).toBe(true)
  const before = await lib.read('python-testing')
  const mutationsBefore = (await lib.listMutations()).length
  const result = await lib.update('python-testing', SKILL)
  expect(result.ok).toBe(true)
  expect(result.noop).toBe(true)
  expect(result.message).toContain('unchanged')
  expect(await lib.read('python-testing')).toBe(before)
  // No audit record was appended (mutation-maturity is not inflated).
  expect((await lib.listMutations()).length).toBe(mutationsBefore)
  await rm(root, { recursive: true, force: true })
})

it('E-69: an archived skill cannot absorb into itself (0.3.18)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-selfabs-'))
  const lib = new SkillLibrary(root)
  const created = await lib.create('python-testing', SKILL, 'background_review')
  expect(created.ok).toBe(true)
  const result = await lib.archive('python-testing', { absorbedInto: 'python-testing' })
  expect(result.ok).toBe(false)
  expect(result.message).toContain('cannot absorb into itself')
  expect((await lib.list()).some(s => s.name === 'python-testing')).toBe(true)
  await rm(root, { recursive: true, force: true })
})
