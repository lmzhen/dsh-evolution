import { expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authoringFeedback, frontmatterCatalogInvalid, parseFrontmatter, resolveSkillsRoot, RESTRUCTURE_TARGET_RE, SKILL_NAME_RE, SkillLibrary, skillsRoot, loadSuppressedNames, loadUsage, nodeEvolutionIo, relatedSkillNames, saveSuppressedNames, saveUsage, validateFrontmatter } from '@deepseek-ai/dsh-evolution-core'

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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  await rm(join(root, '..', 'outside'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('skill protection and path traversal guards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('safe-skill', SKILL.replace('python-testing', 'safe-skill'), 'foreground')
  await writeFile(join(root, 'safe-skill', '.pinned'), '', 'utf8')
  expect((await lib.update('safe-skill', SKILL.replace('python-testing', 'safe-skill'))).ok).toBe(true)
  expect((await lib.archive('safe-skill')).ok).toBe(false)
  expect((await lib.writeSupportFile('safe-skill', '../evil.md', 'bad')).ok).toBe(false)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V8-11: a concurrent patch between the consolidate pre-read and commit survives (0.3.46)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('target-skill', USABLE('target-skill'), 'foreground')
  await lib.create('src-a', USABLE('src-a'), 'foreground')
  // A patch racing the consolidate: the old implementation pre-read the
  // target OUTSIDE the serial queue and committed the merged body over any
  // concurrent patch; V8-11 re-reads inside the serial chain, so BOTH land.
  await Promise.all([
    lib.consolidate('target-skill', ['src-a']),
    lib.patch('target-skill', 'Body of target-skill.', 'PATTERNED-BODY-MARKER', undefined, true),
  ])
  const merged = await lib.read('target-skill') ?? ''
  expect(merged).toMatch(/consolidated from src-a/)
  expect(merged).toMatch(/PATTERNED-BODY-MARKER/)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V8-10: restructure targets with double dots are refused by the shared predicate (0.3.47)', () => {
  // The restructure validator AND the skill-store kernel share the same RE —
  // a `references/my..notes.md` target used to be creatable while every later
  // patch/write/remove on it was refused as traversal (an orphan file).
  expect(RESTRUCTURE_TARGET_RE.test('references/my..notes.md')).toBe(false)
  // Legitimate single-dot names still pass.
  expect(RESTRUCTURE_TARGET_RE.test('references/v1.2.md')).toBe(true)
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('snapshot restore rolls back to the pre-rollback snapshot when the restore fails (E-13, 0.3.16)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-'))
  const lib = new SkillLibrary(root)
  await lib.create('keep-skill', USABLE('keep-skill'), 'foreground')
  const baseline = await lib.snapshotAll('baseline')
  // Damage the restore target: its keep-skill entry is gone, so the
  // manifest-driven copy throws mid-restore (after the root was cleared).
  await rm(join(baseline, 'keep-skill'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  await lib.create('other-skill', USABLE('other-skill'), 'foreground')
  const result = await lib.restoreLatestSnapshot()
  expect(result.ok).toBe(false)
  expect(result.message).toContain('rolled back')
  const names = (await lib.list()).map(s => s.name)
  // The active root is the PRE-rollback state (both skills were present when
  // the restore ran and failed) — never a cleared tree.
  expect(names).toContain('other-skill')
  expect(names).toContain('keep-skill')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
    // v22 (LOCK-1): tree-change writes now commit through the CAS transact —
    // whose tmp+rename does NOT route through io.writeText — so the failure
    // injection sits at the layer the commit actually uses.
    transact: async (path: string, task: (current: string | null) => string | null) => {
      if (failTargetWrite && path.includes('target-skill')) throw new Error('target write blocked')
      return real.transact!(path, task)
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V26-14: snapshotAll probes live write locks — a locked skill is skipped, recorded, and not copied', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-probe-'))
  const lib = new SkillLibrary(root)
  await lib.create('kept-skill', USABLE('kept-skill'), 'foreground')
  await lib.create('locked-skill', USABLE('locked-skill'), 'foreground')
  // A live writer lock on locked-skill (pid:token body — any well-formed
  // body trips the conservative probe; liveness is not consulted here).
  await writeFile(join(root, 'locked-skill', 'SKILL.md.lock'), `${process.pid}:deadbeef`, 'utf8')
  const baseline = await lib.snapshotAll('probe-test')
  const manifest = JSON.parse(await readFile(join(baseline, 'manifest.json'), 'utf8')) as { skills: string[]; skipped: string[] }
  // The locked skill is recorded as skipped and its directory is NOT in the
  // snapshot; the unlocked skill is copied as usual.
  expect(manifest.skipped).toEqual(['locked-skill'])
  expect(manifest.skills).toEqual(['kept-skill'])
  expect(await nodeEvolutionIo().exists(join(baseline, 'kept-skill'))).toBe(true)
  expect(await nodeEvolutionIo().exists(join(baseline, 'locked-skill'))).toBe(false)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V27 G0.1 (core-a-10): an INCOMPLETE snapshot is refused before the destructive clear', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-skipped-'))
  const lib = new SkillLibrary(root)
  await lib.create('kept-skill', USABLE('kept-skill'), 'foreground')
  await lib.create('locked-skill', USABLE('locked-skill'), 'foreground')
  const baseline = await lib.snapshotAll('pre-test')
  // Simulate a snapshot taken while `locked-skill` was write-locked: the
  // manifest records it under `skipped` and its directory is absent from the
  // snapshot (exactly what the V24-20b probe produces).
  const manifestPath = join(baseline, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { skills: string[]; skipped: string[] }
  manifest.skills = manifest.skills.filter(name => name !== 'locked-skill')
  manifest.skipped = ['locked-skill']
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  await rm(join(baseline, 'locked-skill'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  const beforeNames = (await lib.list()).map(s => s.name).sort()
  const beforeBytes = await readFile(join(root, 'locked-skill', 'SKILL.md'), 'utf8')
  // v25 restored such a snapshot and only added a NOTE to the message, which
  // cleared the live library of every skipped skill while reporting success.
  // The snapshot is now refused by name, and the live tree is left as it was
  // (the pre-rollback snapshot rolls the untouched tree back over itself).
  const restored = await lib.restoreLatestSnapshot()
  expect(restored.ok).toBe(false)
  expect(restored.message).toContain('incomplete')
  expect(restored.message).toContain('locked-skill')
  expect(restored.message).toContain('rolled back')
  expect((await lib.list()).map(s => s.name).sort()).toEqual(beforeNames)
  expect(await readFile(join(root, 'locked-skill', 'SKILL.md'), 'utf8')).toBe(beforeBytes)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V27 G0.1 (core-a-10): a snapshot that skipped EVERY skill cannot empty the live library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-allskip-'))
  const io = nodeEvolutionIo()
  const lib = new SkillLibrary(root, io)
  await lib.create('alpha', USABLE('alpha'), 'foreground')
  await lib.create('beta', USABLE('beta'), 'foreground')
  // A live writer holds both skills → snapshotAll skips both (skills: [],
  // skipped: [alpha, beta]). This was the exact shape that reached
  // restoreLatestSnapshot and cleared the whole live library with ok:true.
  for (const name of ['alpha', 'beta']) {
    await writeFile(join(root, name, 'SKILL.md.lock'), `${process.pid}:abc123`, 'utf8')
  }
  const snap = await lib.snapshotAll('all-locked')
  const manifest = JSON.parse(await readFile(join(snap, 'manifest.json'), 'utf8')) as { skills: string[]; skipped: string[] }
  expect(manifest.skills).toEqual([])
  expect(manifest.skipped.sort()).toEqual(['alpha', 'beta'])
  // Locks released: the restore is now attempted against a snapshot that
  // brought back nothing — it must refuse and leave both skills in place.
  for (const name of ['alpha', 'beta']) await rm(join(root, name, 'SKILL.md.lock'), { force: true })
  const restored = await lib.restoreLatestSnapshot()
  expect(restored.ok).toBe(false)
  expect(restored.message).toContain('incomplete')
  expect((await lib.list()).map(s => s.name).sort()).toEqual(['alpha', 'beta'])
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V27 G0.3 (core-a-07): a skill whose description is a YAML block scalar is writable and readable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-blockscalar-'))
  const lib = new SkillLibrary(root)
  // The model writes folded descriptions routinely; the platform's strict YAML
  // catalog loads them, but the family used to reject every create/update/patch
  // of such a file ("frontmatter rewrite verification failed" + advice to wrap
  // the value in quotes, which would corrupt it) and published ">" as the
  // description, losing the routing information.
  const folded = USABLE('block-scalar').replace('description: A usable skill for consolidation tests.', 'description: >\n  Block scalar description that\n  spans two source lines.')
  const created = await lib.create('block-scalar', folded, 'foreground')
  expect(created.ok, created.message).toBe(true)
  // The description reads back folded, not as the indicator.
  const listed = (await lib.list()).find(skill => skill.name === 'block-scalar')
  expect(listed?.description).toBe('Block scalar description that spans two source lines.')
  // The on-disk frontmatter keeps its block form (the write path must not
  // rewrite it into a quoted scalar).
  const written = await readFile(join(root, 'block-scalar', 'SKILL.md'), 'utf8')
  expect(written).toContain('description: >')
  expect(frontmatterCatalogInvalid(written)).toBe(false)
  // update and patch of the same skill stay writable.
  const updated = await lib.update('block-scalar', folded.replace('spans two source lines.', 'now updated.'))
  expect(updated.ok, updated.message).toBe(true)
  const patched = await lib.patch('block-scalar', 'now updated.', 'patched in place.')
  expect(patched.ok, patched.message).toBe(true)
  expect(await readFile(join(root, 'block-scalar', 'SKILL.md'), 'utf8')).toContain('patched in place.')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V27 G0.4 (core-a-01): a manifest with non-string extras is refused before the tree is touched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-extras-gate-'))
  const lib = new SkillLibrary(root)
  await lib.create('keeper-skill', USABLE('keeper-skill'), 'foreground')
  const snap = await lib.snapshotAll('extras-gate', [{ name: 'curator-state.json', content: '{"lastRunAt":1}' }])
  const manifestPath = join(snap, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  // `123` used to survive the array check and `SNAPSHOT_EXTRA_NAME_RE.test`
  // (which coerces), then threw TypeError inside path.join — AFTER the restore
  // had already replaced the tree, so the mutation event never fired.
  await writeFile(manifestPath, JSON.stringify({ ...manifest, extras: [123, 'curator-state.json'] }), 'utf8')
  const before = (await lib.list()).map(s => s.name).sort()
  const restored = await lib.restoreLatestSnapshot()
  expect(restored.ok).toBe(true)
  expect(restored.extras?.map(extra => extra.name)).toEqual(['curator-state.json'])
  // The tree still holds the skill and the restore completed (no TypeError).
  expect((await lib.list()).map(s => s.name).sort()).toEqual(before)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V7-11: a replaceAll beyond the CUMULATIVE fuzzy budget is refused whole (0.3.44)', async () => {
  // V7-11 (0.3.44) test gap: the single-scan budget was covered from the
  // beginning, but a multi-hit replaceAll whose per-scan cost stays below the
  // limit yet sums past it used to run unbounded. Each fuzzy hit re-scans the
  // whole (shrinking) content: 300 sections × ~1M work per scan ≈ 300M ≫ 8M.
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-v711-'))
  const lib = new SkillLibrary(root)
  const section = '## Section title\n\ncontent line one two three\n'
  const body = `---
name: fuzzy-budget
description: A skill for the cumulative fuzzy budget test.
---
\n
` + section.repeat(300)
  await mkdir(join(root, 'fuzzy-budget'), { recursive: true })
  await writeFile(join(root, 'fuzzy-budget', 'SKILL.md'), body, 'utf8')
  try {
    // Double-space old string: NOT an exact hit — the fuzzy matcher tolerates
    // the whitespace run, so every section is a fuzzy match → replaceAll.
    const result = await lib.patch('fuzzy-budget', '## Section  title', '## Renamed section', undefined, true)
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/fuzzy budget was exceeded/)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

it('V9-04: consolidate of a MISSING target refuses BEFORE archiving any source (0.3.50)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-v904-'))
  const lib = new SkillLibrary(root)
  await lib.create('src-a', USABLE('src-a'), 'foreground')
  // V8-11 moved the authoritative read into the serial queue, which silently
  // turned this clean refusal into "archive ALL sources then roll back" (a
  // half-completed tree when a restore fails). The pre-check makes the
  // failure path non-destructive again.
  const result = await lib.consolidate('no-such-target', ['src-a'])
  expect(result.ok).toBe(false)
  expect(result.message).toContain('not found')
  expect((await lib.list()).some(s => s.name === 'src-a')).toBe(true) // not archived
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  // V27 G2.1: what the write path lands is exactly what the reader declares
  // valid as written — the writer and the audit agree on the same bytes.
  expect(frontmatterCatalogInvalid(onDisk)).toBe(false)
  expect(parseFrontmatter(onDisk)?.frontmatter['description']).toBe('Search: arXiv papers by keyword.')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('E-68: an old===new patch is a noop — no write, no audit, no mutation event (0.3.18)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-noop-'))
  const events: string[] = []
  const lib = new SkillLibrary(root, nodeEvolutionIo(), undefined, e => events.push(`${e.action}:${e.name}`))
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('F-316: a drop-in root dot-file created AFTER the snapshot is cleaned on restore, while the audit sidecar survives', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-dotrestore-'))
  const lib = new SkillLibrary(root)
  await lib.create('python-testing', SKILL, 'foreground')
  const snapshot = await lib.snapshotAll('before-dotfile')
  expect(typeof snapshot).toBe('string')
  // Simulate state written after the snapshot: usage is derived data and
  // must go with the tree; the mutation audit is real history and stays.
  await writeFile(join(root, '.usage.json'), '{"python-testing":{"use_count":9}}', 'utf8')
  await writeFile(join(root, '.mutations.json'), '["old-audit"]', 'utf8')
  await writeFile(join(root, '.backups', 'skills-keep.me'), 'x', 'utf8')
  const restored = await lib.restoreLatestSnapshot()
  expect(restored.ok).toBe(true)
  expect(await readFile(join(root, '.usage.json'), 'utf8').then(() => false, () => true)).toBe(true)
  expect(await readFile(join(root, '.mutations.json'), 'utf8')).toBe('["old-audit"]')
  expect(await readFile(join(root, '.backups', 'skills-keep.me'), 'utf8')).toBe('x')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('F-321: relatedSkillNames skips CamelCase fragments and only takes delimited lowercase names', async () => {
  const content = '---\nname: demo\nrelated_skills: MySkill,Something python-testing\n---\nbody'
  const names = relatedSkillNames(content, 'demo')
  // CamelCase 'MySkill'/'Something' must produce no fragment ('y', 'kill',
  // 'omething'); the delimited lowercase name is the only reference.
  expect(names).toEqual(['python-testing'])
})

it('V6-17: a non-exact anchor past the fuzzy budget is refused with an honest message (0.3.37)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-fuzzyguard-'))
  const lib = new SkillLibrary(root)
  await lib.create('python-testing', SKILL, 'foreground')
  // A 5000-char non-exact old_string would drive the O(n·m) fuzzy scan into
  // seconds of event-loop blocking — refuse it up front.
  const huge = 'x'.repeat(5000)
  const result = await lib.patch('python-testing', `${huge}NEVER-MATCHES`, 'replacement')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('too large for fuzzy match')
  // An exact large old_string is served by the fast includes path — still allowed.
  const exact = await lib.patch('python-testing', 'Run tests with pytest.', 'Run tests with pytest v2.')
  expect(exact.ok).toBe(true)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V6-19: a transact contract violation returns a structured error, not a TypeError (0.3.37)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-shapeguard-'))
  // A backend whose transact never invokes the task (contract violation).
  const io = {
    readText: async (path: string) => path.endsWith('SKILL.md') ? SKILL : null,
    writeText: async () => {},
    remove: async () => {},
    list: async () => [],
    exists: async (path: string) => path.endsWith('SKILL.md'),
    rename: async () => {},
    copy: async () => {},
    transact: async () => {},
  }
  const lib = new SkillLibrary(root, io)
  const result = await lib.update('python-testing', SKILL.replace('Run tests with pytest.', 'Updated.'))
  expect(result.ok).toBe(false)
  expect(result.message).toContain('did not invoke the task')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('A1-17 (v18): a failed marker probe reports protectionUnknown, never "unprotected"', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-unknown-'))
  // Create the skill through a HEALTHY io first — the failing probes below are
  // only installed for the listing pass, so create() keeps its normal markers.
  await new SkillLibrary(root).create('ghost-skill', SKILL.replace('python-testing', 'ghost-skill'), 'foreground')
  const base = nodeEvolutionIo()
  const skillDir = join(root, 'ghost-skill')
  const io = {
    ...base,
    // The directory listing fails (EACCES) AND the per-marker fallback probes
    // fail too — the only honest answer is "unknown".
    list: async (path: string) => {
      if (path === skillDir) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      return base.list(path)
    },
    exists: async (path: string) => {
      if (/\.(pinned|bundled|hub-installed|hermes-managed)$/.test(path)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      return base.exists(path)
    },
  }
  const lib = new SkillLibrary(root, io)
  const summary = (await lib.list()).find(item => item.name === 'ghost-skill')
  expect(summary?.protectedBy).toBeNull()
  expect(summary?.protectionUnknown).toBe(true)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('A1-20 (v18): restoring onto a directory without SKILL.md names the real obstacle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-restore-dir-'))
  const lib = new SkillLibrary(root)
  await lib.create('restore-target', SKILL.replace('python-testing', 'restore-target'), 'foreground')
  expect((await lib.archive('restore-target')).ok).toBe(true)
  // A partial/hand-made directory squats on the destination — the old probe
  // only checked SKILL.md and let moveDir fail with a different message.
  await mkdir(join(root, 'restore-target'), { recursive: true })
  const result = await lib.restoreFromArchive('restore-target')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('carries no SKILL.md')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('计划 B-4 (v18): SKILL_NAME_RE matches the upstream shape', async () => {
  expect(SKILL_NAME_RE.test('good-skill')).toBe(true)
  expect(SKILL_NAME_RE.test('a1')).toBe(true)
  expect(SKILL_NAME_RE.test('trailing-')).toBe(false)
  expect(SKILL_NAME_RE.test('double--hyphen')).toBe(false)
  expect(SKILL_NAME_RE.test('-leading')).toBe(false)
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-name-'))
  const lib = new SkillLibrary(root)
  expect((await lib.create('trailing-', SKILL.replace('python-testing', 'trailing-'), 'foreground')).ok).toBe(false)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('E-11 (v18): list() publishes the frontmatter whenToUse routing hint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-when-'))
  const lib = new SkillLibrary(root)
  const body = '---\nname: routed-skill\ndescription: Routed skill.\nwhenToUse: Use for routing checks.\n---\n\n# Routed\n'
  await lib.create('routed-skill', body, 'foreground')
  const summary = (await lib.list()).find(item => item.name === 'routed-skill')
  expect(summary?.whenToUse).toBe('Use for routing checks.')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V27 G2.1: list() publishes the strict catalog value, and the audit verdict agrees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-strict-'))
  const lib = new SkillLibrary(root)
  // Authored outside the family (the write point would quote this value): an
  // unquoted ` # ` is a YAML comment, so the platform catalog reads
  // `routing word` and the family must publish exactly that.
  const commented = '---\nname: commented-skill\ndescription: routing word # trailing note\n---\n\n# Commented\n'
  const commentedDir = join(root, 'commented-skill')
  await mkdir(commentedDir, { recursive: true })
  await writeFile(join(commentedDir, 'SKILL.md'), commented, 'utf8')
  const summary = (await lib.list()).find(item => item.name === 'commented-skill')
  expect(summary?.description).toBe('routing word')
  expect(summary?.description).toBe(parseFrontmatter(commented)?.frontmatter.description)
  expect(validateFrontmatter(commented, 'commented-skill')).toBeNull()
  // The raw value is still flagged (the comment would be dropped by the
  // platform and the family publishes the quoted form only after the next
  // write), so the audit keeps reporting this file rather than calling it clean.
  expect(frontmatterCatalogInvalid(commented)).toBe(true)
  const clean = '---\nname: clean-skill\ndescription: Plain routing text.\n---\n\n# Clean\n'
  const cleanDir = join(root, 'clean-skill')
  await mkdir(cleanDir, { recursive: true })
  await writeFile(join(cleanDir, 'SKILL.md'), clean, 'utf8')
  expect(frontmatterCatalogInvalid(clean)).toBe(false)
  expect((await lib.list()).find(item => item.name === 'clean-skill')?.description).toBe('Plain routing text.')
  // A block the strict parser rejects stays routable INSIDE the family — the
  // platform cannot load the file, and the audit reports that instead of a
  // silent visibility split.
  const unloadable = '---\nname: unloadable-skill\ndescription: Search: arXiv papers\n---\n\n# Unloadable\n'
  const unloadableDir = join(root, 'unloadable-skill')
  await mkdir(unloadableDir, { recursive: true })
  await writeFile(join(unloadableDir, 'SKILL.md'), unloadable, 'utf8')
  expect((await lib.list()).find(item => item.name === 'unloadable-skill')?.description).toBe('Search: arXiv papers')
  expect(frontmatterCatalogInvalid(unloadable)).toBe(true)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V27 G8.4: an archived skill whose SKILL.md is empty is still restorable by name', async () => {
  const { readdir, stat } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-archname-'))
  const lib = new SkillLibrary(root)
  await lib.create('arch-name-skill', SKILL.replace('python-testing', 'arch-name-skill'), 'foreground')
  expect((await lib.archive('arch-name-skill')).ok).toBe(true)
  const archiveRoot = join(root, '.archive')
  // The archive records the owning name next to the tree: the restore match used
  // to depend on the archived frontmatter alone.
  expect(await readFile(join(archiveRoot, 'arch-name-skill', '.archive-name'), 'utf8')).toBe('arch-name-skill\n')
  // A crashed writer leaves a 0-byte SKILL.md in the archive — the file no
  // longer says which skill this was.
  await writeFile(join(archiveRoot, 'arch-name-skill', 'SKILL.md'), '', 'utf8')
  const restored = await lib.restoreFromArchive('arch-name-skill')
  expect(restored.ok).toBe(true)
  // Both archive metadata markers are dropped on restore, so the live tree is
  // the tree that was archived.
  const lives = await readdir(join(root, 'arch-name-skill'))
  expect(lives).not.toContain('.archive-name')
  expect(lives).not.toContain('.archive-reason')
  // The same holds for a STAMPED archive entry (the second archive of one
  // name): the bare directory name cannot match it, the marker can.
  expect((await lib.archive('arch-name-skill')).ok).toBe(true)
  expect((await lib.create('arch-name-skill', SKILL.replace('python-testing', 'arch-name-skill'), 'foreground')).ok).toBe(true)
  expect((await lib.archive('arch-name-skill')).ok).toBe(true)
  const stamped = (await readdir(archiveRoot)).filter(entry => entry.startsWith('arch-name-skill-'))
  expect(stamped.length).toBe(1)
  await writeFile(join(archiveRoot, stamped[0]!, 'SKILL.md'), '', 'utf8')
  // Leave ONLY the stamped entry, so the match has to come from the marker.
  await rm(join(archiveRoot, 'arch-name-skill'), { recursive: true, force: true })
  expect((await lib.restoreFromArchive('arch-name-skill')).ok).toBe(true)
  expect((await stat(join(root, 'arch-name-skill'))).isDirectory()).toBe(true)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('A1-15 (v18): a post-commit dir-fsync failure still audits and reports a durability warning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-durability-'))
  await new SkillLibrary(root).create('durable-skill', SKILL.replace('python-testing', 'durable-skill'), 'foreground')
  const base = nodeEvolutionIo()
  // The rename landed; only the parent-directory fsync failed (the marker the
  // io layer attaches). A plain failure would make the caller roll back — or
  // retry — a write that is already visible on disk.
  // Drop the transact seam so the store takes its single-write path and calls
  // THIS writeText (the node backend's transact writes through module-level
  // helpers and would bypass the injected failure).
  const { transact: _droppedTransact, ...withoutTransact } = base
  void _droppedTransact
  const io = {
    ...withoutTransact,
    writeText: async (path: string, content: string) => {
      await base.writeText(path, content)
      throw Object.assign(new Error('simulated dir-fsync failure'), { committed: true })
    },
  }
  const lib = new SkillLibrary(root, io)
  const updated = await lib.update('durable-skill', SKILL.replace('python-testing', 'durable-skill').replace('Run tests with pytest.', 'Updated after the fsync failure.'), 'foreground')
  expect(updated.ok).toBe(true)
  expect(updated.message).toContain('durability unconfirmed')
  // The bytes ARE on disk and the audit trail recorded the write.
  expect(await lib.read('durable-skill')).toContain('Updated after the fsync failure.')
  expect((await lib.listMutations()).some(m => m.skillName === 'durable-skill' && m.action === 'update')).toBe(true)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('P2-2 (v19): create and setPinned tolerate a post-commit fsync failure too', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-durability2-'))
  const base = nodeEvolutionIo()
  const { transact: _droppedTransact2, ...withoutTransact2 } = base
  void _droppedTransact2
  const io = {
    ...withoutTransact2,
    writeText: async (path: string, content: string) => {
      await base.writeText(path, content)
      throw Object.assign(new Error('simulated dir-fsync failure'), { committed: true })
    },
  }
  const lib = new SkillLibrary(root, io)
  const created = await lib.create('durable-create', SKILL.replace('python-testing', 'durable-create'), 'foreground')
  expect(created.ok).toBe(true)
  expect(created.message).toContain('durability unconfirmed')
  expect(await lib.read('durable-create')).toContain('durable-create')
  // The marker write has the same semantics: reporting a failure would make
  // the retry answer "already pinned" for a marker that landed.
  const pinned = await lib.setPinned('durable-create', true, 'foreground')
  expect(pinned.ok).toBe(true)
  expect(pinned.message).toContain('durability unconfirmed')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('P1-2 (v19): a healthy empty-tree snapshot WITH sidecars restores (guard reads manifest.sidecars)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-snap-sidecar-'))
  const lib = new SkillLibrary(root)
  await lib.create('only-skill', SKILL.replace('python-testing', 'only-skill'), 'foreground')
  // The co-snapshotted sidecars every real deployment has (usage/suppression).
  await writeFile(join(root, '.usage.json'), JSON.stringify({ 'only-skill': { created_by: 'agent', created_at: '2026-01-01T00:00:00.000Z', use_count: 0, view_count: 1, patch_count: 0, last_used_at: null, last_viewed_at: '2026-01-01T00:00:00.000Z', last_patched_at: null, state: 'active', pinned: false, archived_at: null } }), 'utf8')
  await writeFile(join(root, '.curator-suppressed.json'), JSON.stringify({ version: 1, names: ['legacy-skill'] }), 'utf8')
  expect((await lib.archive('only-skill')).ok).toBe(true)
  expect((await lib.list()).length).toBe(0)
  // The scenario: the curator archived everything, then a snapshot was taken
  // (empty tree + the co-snapshotted sidecars).
  await lib.snapshotAll('empty-tree')
  const restored = await lib.restoreLatestSnapshot()
  expect(restored.ok, restored.message).toBe(true)
  // The snapshot captured the EMPTY tree — the point is that restoring it is
  // possible at all, and that the co-snapshotted sidecar comes back.
  expect((await lib.list()).length).toBe(0)
  expect((JSON.parse(await readFile(join(root, '.usage.json'), 'utf8')) as Record<string, unknown>)['only-skill']).toBeDefined()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('P1-2 (v19): a truncated manifest (declares no skills, directory has UNDECLARED entries) is still refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-snap-truncated-'))
  const lib = new SkillLibrary(root)
  await lib.create('ghost-skill', SKILL.replace('python-testing', 'ghost-skill'), 'foreground')
  const snap = await lib.snapshotAll('truncated')
  const manifestPath = join(snap, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  await writeFile(manifestPath, JSON.stringify({ ...manifest, skills: [] }), 'utf8')
  const result = await lib.restoreLatestSnapshot()
  expect(result.ok).toBe(false)
  expect(result.message).toContain('undeclared entries')
  expect((await lib.list()).map(item => item.name)).toContain('ghost-skill')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('P2-4 (v19): a non-string manifest entry is refused structurally, not with a TypeError', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-snap-nonstring-'))
  const lib = new SkillLibrary(root)
  await lib.create('real-skill', SKILL.replace('python-testing', 'real-skill'), 'foreground')
  const snap = await lib.snapshotAll('non-string')
  const manifestPath = join(snap, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  await writeFile(manifestPath, JSON.stringify({ ...manifest, skills: [123, null] }), 'utf8')
  const result = await lib.restoreLatestSnapshot()
  expect(result.ok).toBe(false)
  expect(result.message).toContain('unsafe entry name')
  expect(result.message).not.toContain('is not a function')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('v28 G1.1 (EVO-IO-02): update on a ghost directory removes it instead of blocking restore forever', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-ghost-'))
  const lib = new SkillLibrary(root)
  await lib.create('ghost-skill', SKILL.replace('python-testing', 'ghost-skill'), 'foreground')
  const { rm: rmDir } = await import('node:fs/promises')
  // Simulate the archive-probe race outcome: the directory moved away and the
  // io seam's mkdir-before-lock resurrected it EMPTY (no SKILL.md).
  await rmDir(join(root, 'ghost-skill', 'SKILL.md'))
  const result = await lib.update('ghost-skill', SKILL.replace('python-testing', 'ghost-skill'), 'foreground')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('not found')
  // The ghost is gone: a later restoreFromArchive is not blocked by the
  // "already exists … carries no SKILL.md" refusal.
  const { stat } = await import('node:fs/promises')
  await expect(stat(join(root, 'ghost-skill'))).rejects.toMatchObject({ code: 'ENOENT' })
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('v28 G1.1 (EVO-IO-02): the ghost cleanup never takes a directory with real content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-ghost2-'))
  const lib = new SkillLibrary(root)
  await lib.create('partial-skill', SKILL.replace('python-testing', 'partial-skill'), 'foreground')
  const { rm: rmDir, writeFile, mkdir } = await import('node:fs/promises')
  // No SKILL.md but real support content: the cleanup must leave it alone.
  await rmDir(join(root, 'partial-skill', 'SKILL.md'))
  await mkdir(join(root, 'partial-skill', 'references'), { recursive: true })
  await writeFile(join(root, 'partial-skill', 'references', 'keep.md'), 'keep me\n', 'utf8')
  const result = await lib.update('partial-skill', SKILL.replace('python-testing', 'partial-skill'), 'foreground')
  expect(result.ok).toBe(false)
  const { stat } = await import('node:fs/promises')
  expect((await stat(join(root, 'partial-skill'))).isDirectory()).toBe(true)
  expect(await readFile(join(root, 'partial-skill', 'references', 'keep.md'), 'utf8')).toContain('keep me')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('v28 G2.5 (CORE-SK-03): both refusals pre-clear report an UNCHANGED tree, not "Rescue manually"', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-restore3-'))
  const lib = new SkillLibrary(root)
  await lib.create('locked-skill', SKILL.replace('python-testing', 'locked-skill'), 'foreground')
  // Latest complete snapshot (pre-lock).
  await lib.snapshotAll('test')
  // Now create a second skill and hold a LIVE write lock on it.
  await lib.create('second-skill', SKILL.replace('python-testing', 'second-skill'), 'foreground')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(root, 'second-skill', 'SKILL.md.lock'), `${process.pid}:deadbeef`, 'utf8')
  const result = await lib.restoreLatestSnapshot()
  expect(result.ok).toBe(false)
  // The target restore refuses on the live lock; the pre-rollback snapshot is
  // incomplete (second-skill was skipped) and refuses on completeness — both
  // pre-clear, so nothing was ever touched.
  expect(result.message).toContain('UNCHANGED')
  expect(result.message).not.toContain('Rescue manually')
  // The library is intact.
  const { stat } = await import('node:fs/promises')
  expect((await stat(join(root, 'locked-skill', 'SKILL.md'))).isFile()).toBe(true)
  expect((await stat(join(root, 'second-skill', 'SKILL.md'))).isFile()).toBe(true)
  await rm(join(root, 'second-skill', 'SKILL.md.lock'), { force: true })
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('v29 LIST-01: a directory squatting on SKILL.md skips the entry instead of killing the whole listing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-listeisdir-'))
  const lib = new SkillLibrary(root)
  await lib.create('healthy-skill', SKILL.replace('python-testing', 'healthy-skill'), 'foreground')
  await lib.create('broken-skill', SKILL.replace('python-testing', 'broken-skill'), 'foreground')
  const { rm: rmPath, mkdir, writeFile } = await import('node:fs/promises')
  // The E-43 shape: a DIRECTORY on the SKILL.md path (half-extracted artifact).
  await rmPath(join(root, 'broken-skill', 'SKILL.md'))
  await mkdir(join(root, 'broken-skill', 'SKILL.md'))
  await writeFile(join(root, 'broken-skill', 'SKILL.md', 'junk'), 'x', 'utf8')
  // Previously: list() rejected wholesale with EISDIR while read() said
  // "not found" — now both surfaces agree the entry is effectively absent.
  const summaries = await lib.list()
  expect(summaries.map(s => s.name)).toEqual(['healthy-skill'])
  expect(await lib.read('broken-skill')).toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('v30 REG-01: a non-EISDIR read failure (EACCES) still fails list() loud — no silent partial tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-skills-acces-'))
  const { mkdir, writeFile } = await import('node:fs/promises')
  const stubIo = {
    ...nodeEvolutionIo(),
    readText: async (path: string) => {
      if (path.includes('locked-skill')) {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      }
      return '---\nname: open-skill\ndescription: Visible.\n---\n\nbody\n'
    },
  }
  await mkdir(join(root, 'locked-skill'), { recursive: true })
  await writeFile(join(root, 'locked-skill', 'SKILL.md'), 'x', 'utf8')
  await mkdir(join(root, 'open-skill'), { recursive: true })
  await writeFile(join(root, 'open-skill', 'SKILL.md'), '---\nname: open-skill\ndescription: Visible.\n---\n\nbody\n', 'utf8')
  // A transient EACCES on ONE entry must NOT silently produce a partial tree
  // (the curator's E-15 fold would archive the "missing" live skill forever);
  // it fails loud instead. Only the EISDIR shape is absorbed (v29 LIST-01).
  const lib = new SkillLibrary(root, stubIo)
  await expect(lib.list()).rejects.toMatchObject({ code: 'EACCES' })
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
