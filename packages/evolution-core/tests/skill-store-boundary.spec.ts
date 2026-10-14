// @tier pre-tag
import { describe, expect, it } from 'vitest'
import { SkillLibrary, loadMutations } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { fakeIo } from '../../test-support/fake-io.ts'
import { deadLockBody } from '../../test-support/lock-fixtures.ts'
const SKILL = '---\nname: boundary-skill\ndescription: Boundary test skill.\n---\n\n# Boundary\n\nKeep me.\n'

describe('SkillLibrary IO boundaries', () => {
  it('preserves support files when archive falls back from rename to copy+remove', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    expect((await lib.create('boundary-skill', SKILL, 'background_review')).ok).toBe(true)
    expect((await lib.writeSupportFile('boundary-skill', 'references/detail.md', '# Detail')).ok).toBe(true)
    const archived = await lib.archive('boundary-skill')
    expect(archived.ok).toBe(true)
    expect(await io.readText(`${archived.path}/SKILL.md`)).toBeTruthy()
    expect(await io.readText(`${archived.path}/references/detail.md`)).toBe('# Detail')
    expect(await io.exists('/skills/boundary-skill')).toBe(false)
  })

  it('snapshot and restore round-trips support files', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    await lib.writeSupportFile('boundary-skill', 'scripts/run.mjs', 'export {}')
    await lib.snapshotAll('pre-test')
    await lib.archive('boundary-skill')
    const restored = await lib.restoreLatestSnapshot()
    expect(restored.ok).toBe(true)
    expect(await io.readText('/skills/boundary-skill/SKILL.md')).toBeTruthy()
    expect(await io.readText('/skills/boundary-skill/scripts/run.mjs')).toBe('export {}')
  })

  it('refuses to archive a symlinked skill (G7)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('linky-skill', SKILL.replace('boundary-skill', 'linky-skill'), 'foreground')
    // Mark the skill directory as a symlink for the probe.
    await io.writeText('/skills/linky-skill.symlink', 'true')
    const result = await lib.archive('linky-skill')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('符号链接')
    // The tree is untouched.
    expect(await io.readText('/skills/linky-skill/SKILL.md')).toBeTruthy()
  })

  it('restore clears non-system residue the manifest does not declare (P2-14)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('keep-skill', SKILL.replace('boundary-skill', 'keep-skill'), 'foreground')
    await lib.snapshotAll('pre-residue')
    // A stray file lands in the active root AFTER the snapshot; it is not a
    // declared skill and must not survive the manifest-driven restore.
    await io.writeText('/skills/stray-thing.md', 'not a skill')
    const restored = await lib.restoreLatestSnapshot()
    expect(restored.ok).toBe(true)
    expect(await io.exists('/skills/stray-thing.md')).toBe(false)
    expect(await io.readText('/skills/keep-skill/SKILL.md')).toBeTruthy()
  })
})

// ── v10 audit batch 3a boundary hardening (C-14 / C-15 / C-16 / C-18) ───────

describe('V10 boundary hardening', () => {
  it('C-14: a 0-byte SKILL.md is listed (description empty, markers visible) and stays archivable', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    // A "present but corrupt" tree: the file exists (listNames proves it) but
    // is empty, and the directory carries a protection marker — the old ghost
    // skip hid all of it from list().
    io.files.set('/skills/ghost-skill/SKILL.md', '')
    io.files.set('/skills/ghost-skill/.pinned', '')
    const summaries = await lib.list()
    const ghost = summaries.find(s => s.name === 'ghost-skill')
    expect(ghost).toBeDefined()
    expect(ghost?.description).toBe('')
    expect(ghost?.protectedBy).toBe('pinned')
    // An unmarked 0-byte tree can be archived (no body bytes needed).
    io.files.set('/skills/corrupt-skill/SKILL.md', '')
    const archived = await lib.archive('corrupt-skill')
    expect(archived.ok).toBe(true)
    expect(await io.exists('/skills/.archive/corrupt-skill/SKILL.md')).toBe(true)
  })

  it('C-15: create refuses a pre-existing directory carrying a protection marker', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    io.files.set('/skills/guarded/.bundled', '')
    const bundled = await lib.create('guarded', SKILL.replace('boundary-skill', 'guarded'), 'foreground')
    expect(bundled.ok).toBe(false)
    expect(bundled.message).toContain('受保护（bundled）')
    expect(io.files.has('/skills/guarded/SKILL.md')).toBe(false)
    // Review channel: a pinned marker refuses the same way update/patch do.
    io.files.set('/skills/review-target/.pinned', '')
    const review = await lib.create('review-target', SKILL.replace('boundary-skill', 'review-target'), 'background_review')
    expect(review.ok).toBe(false)
    expect(review.message).toContain('受保护（pinned）')
    // Foreground keeps update/patch parity: pin blocks the review fork only.
    const fg = await lib.create('review-target', SKILL.replace('boundary-skill', 'review-target'), 'foreground')
    expect(fg.ok).toBe(true)
  })

  it('C-16: consolidate name validation carries the 64-char ceiling via badName', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    const long = 'a'.repeat(65)
    const result = await lib.consolidate('target', [long], 'foreground')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('技能名')
    expect(result.message).toContain('不超过 64 个')
  })

  it('C-18: support file names are closed to [a-z0-9._-] plus the win32 reserved stems', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('named', SKILL.replace('boundary-skill', 'named'), 'foreground')
    // Charset violations (colon, uppercase, leading dot/space).
    expect((await lib.writeSupportFile('named', 'references/with:colon.md', 'x')).ok).toBe(false)
    expect((await lib.writeSupportFile('named', 'references/Notes.md', 'x')).ok).toBe(false)
    expect((await lib.writeSupportFile('named', 'references/.hidden.md', 'x')).ok).toBe(false)
    // Reserved device stems are charset-conformant — refused by the stem set.
    const nul = await lib.writeSupportFile('named', 'references/nul.md', 'x')
    expect(nul.ok).toBe(false)
    expect(nul.message).toContain('保留设备名')
    expect((await lib.writeSupportFile('named', 'references/com1.md', 'x')).ok).toBe(false)
    // Nested dirs and ordinary names stay allowed.
    expect((await lib.writeSupportFile('named', 'references/sub/ok-name.md', 'x')).ok).toBe(true)
    expect((await lib.writeSupportFile('named', 'scripts/run_v2.mjs', 'export {}')).ok).toBe(true)
  })
})

// ── v14 audit P1-1 / P2-9 boundary hardening ────────────────────────────────

describe('V14 name-guard unification and archive metadata', () => {
  it('P1-1: patch refuses a traversal name even when the escaped support file EXISTS', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    // A real skill tree OUTSIDE the configured root, with a support file. The
    // pre-fix code built `join(root, '../outside')` and rewrote it (the
    // SKILL.md branch was saved only by the frontmatter name equality check;
    // the support-file branch skipped that check entirely).
    io.files.set('/outside/SKILL.md', SKILL.replace('boundary-skill', 'outside'))
    io.files.set('/outside/references/detail.md', 'ORIGINAL')
    const patched = await lib.patch('../outside', 'ORIGINAL', 'PWNED', 'references/detail.md')
    expect(patched.ok).toBe(false)
    expect(patched.message).toContain('技能名')
    expect(io.files.get('/outside/references/detail.md')).toBe('ORIGINAL')
    // The same guard now covers the SKILL.md branch and the protection probes.
    expect((await lib.patch('../outside', 'ORIGINAL', 'PWNED')).ok).toBe(false)
    expect(await lib.writeProtection('../outside')).toContain('技能名')
    expect(await lib.deleteProtection('../outside')).toContain('技能名')
    expect(await lib.isManaged('../outside')).toBe(false)
    // B3 / N14: the rejected name is ABSENT, not "an empty support list".
    expect(await lib.listSupportFiles('../outside')).toEqual({ kind: 'absent' })
  })

  it('P3-30: an empty or whitespace-only anchor names its own reason, not "not found"', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    const empty = await lib.patch('boundary-skill', '', 'x')
    expect(empty.ok).toBe(false)
    expect(empty.message).toContain('needs an anchor')
    const blank = await lib.patch('boundary-skill', '   \n  ', 'x')
    expect(blank.ok).toBe(false)
    expect(blank.message).toContain('needs an anchor')
    // A genuine miss keeps the original wording.
    const miss = await lib.patch('boundary-skill', 'NOT-IN-THE-FILE', 'x')
    expect(miss.ok).toBe(false)
    expect(miss.message).toContain('找不到 old_string')
  })

  it('P2-9: a failed .archive-reason write does not abort the archive or skip its audit', async () => {
    const base = fakeIo()
    const io: EvolutionIoLike & { files: Map<string, string> } = {
      ...base,
      files: base.files,
      async writeText(path, content) {
        if (path.replaceAll('\\', '/').endsWith('/.archive-reason')) throw new Error('disk full')
        await base.writeText(path, content)
      },
    }
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    const archived = await lib.archive('boundary-skill', { reason: 'Lifecycle: threshold' })
    expect(archived.ok).toBe(true)
    // The move landed and the mutation trail recorded it, so a caller can never
    // report "rolled back" while the tree stays archived.
    expect(await io.exists('/skills/.archive/boundary-skill/SKILL.md')).toBe(true)
    expect((await lib.listMutations()).some(record => record.skillName === 'boundary-skill' && record.action === 'archive')).toBe(true)
  })
})

describe('V15 write-boundary closures', () => {
  it('P2-8: archive refuses a traversal absorbed_into instead of probing outside the root', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    io.files.set('/outside/SKILL.md', SKILL.replace('boundary-skill', 'outside'))
    io.files.set('/outside/secret.txt', 'TOP SECRET')
    const before = io.files.get('/outside/secret.txt')
    const result = await lib.archive('boundary-skill', { absorbedInto: '../outside' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('absorbed_into')
    // Nothing outside the root was read/renamed, and the skill stays live.
    expect(io.files.get('/outside/secret.txt')).toBe('TOP SECRET')
    expect(before).toBe('TOP SECRET')
    expect(await lib.read('boundary-skill')).not.toBeNull()
  })

  it('P2-11: a win32 reserved device stem is refused as a skill name (structured, not raw errno)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    for (const name of ['con', 'nul', 'com1', 'lpt9']) {
      const created = await lib.create(name, SKILL.replace('boundary-skill', name), 'foreground')
      expect(created.ok, name).toBe(false)
      expect(created.message, name).toContain('Windows reserved device name')
      expect(await io.exists(`/skills/${name}/SKILL.md`), name).toBe(false)
    }
  })

  it('P2-10: remove_file refuses a DIRECTORY path instead of recursively wiping it', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    await lib.writeSupportFile('boundary-skill', 'references/sub/one.md', 'ONE')
    await lib.writeSupportFile('boundary-skill', 'references/sub/two.md', 'TWO')
    const removed = await lib.removeSupportFile('boundary-skill', 'references/sub')
    expect(removed.ok).toBe(false)
    expect(removed.message).toContain('not a readable regular file')
    // Both files survive.
    expect(await io.readText('/skills/boundary-skill/references/sub/one.md')).toBe('ONE')
    expect(await io.readText('/skills/boundary-skill/references/sub/two.md')).toBe('TWO')
  })

  it('P2-9: archive succeeds through a transact-capable backend (lock path), moving the whole tree', async () => {
    // fakeIo has NO transact; layer one on top with the transact contract
    // (read -> task -> write, null deletes) so the P2-9 lock path runs.
    const base = fakeIo()
    const io: EvolutionIoLike & { files: Map<string, string> } = {
      ...base,
      files: base.files,
      async transact(path, task) {
        const current = await base.readText(path)
        const next = await task(current)
        if (next === null) await base.remove(path)
        else if (next !== current) await base.writeText(path, next)
      },
    }
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    await lib.writeSupportFile('boundary-skill', 'references/detail.md', '# Detail')
    const archived = await lib.archive('boundary-skill')
    expect(archived.ok).toBe(true)
    expect(await io.readText(`${archived.path}/SKILL.md`)).toBeTruthy()
    expect(await io.readText(`${archived.path}/references/detail.md`)).toBe('# Detail')
    expect(await io.exists('/skills/boundary-skill')).toBe(false)
  })

  it('P3: restoreFromArchive writes an audit record (the one mutation that used to be invisible)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    await lib.archive('boundary-skill')
    const restored = await lib.restoreFromArchive('boundary-skill')
    expect(restored.ok).toBe(true)
    const mutations = await loadMutations('/skills', io)
    expect(mutations.some(record => record.skillName === 'boundary-skill' && record.action === 'restore')).toBe(true)
  })
})

describe('V17 lock-probe and lock-sweep precision', () => {
  it('G2 S4: a `pid:token` file in a support dir is user content too and does NOT block the archive', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    await lib.writeSupportFile('boundary-skill', 'references/note.md', '# note')
    // The body shape that used to mark a writer lock now means nothing: the protocol is retired, so
    // the mover no longer probes it and the bytes travel with the tree.
    io.files.set('/skills/boundary-skill/references/note.md.lock', '4242:deadbeef')
    const archived = await lib.archive('boundary-skill')
    expect(archived.ok).toBe(true)
    expect(await io.readText('/skills/.archive/boundary-skill/references/note.md.lock')).toBe('4242:deadbeef')
    expect(await io.exists('/skills/boundary-skill/SKILL.md')).toBe(false)
  })

  it('a user support file named *.lock does NOT block archiving (S4: body shape is irrelevant now)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    // Legacy tree: the file predates the reserved suffix; its body is user content.
    io.files.set('/skills/boundary-skill/references/timer.lock', 'MY TIMER STATE v3')
    const archived = await lib.archive('boundary-skill')
    expect(archived.ok).toBe(true)
    // The user file rides along into the archive untouched.
    expect(await io.readText('/skills/.archive/boundary-skill/references/timer.lock')).toBe('MY TIMER STATE v3')
  })

  it('G2 S4: a support file named *.lock is a user file again (the writer-lock protocol is retired)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    const result = await lib.writeSupportFile('boundary-skill', 'references/timer.lock', 'state')
    // The suffix used to be refused because a user file was indistinguishable from the io writer
    // lock for the archive/restore probes. Writes now go through the provider's versioned writes, so
    // there is no lock file to confuse it with — and the name is the user's to use.
    expect(result.ok).toBe(true)
    expect(await io.readText('/skills/boundary-skill/references/timer.lock')).toBe('state')
  })

  it('G2 S4: restore keeps every *.lock file (there is no sweep any more)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    await lib.writeSupportFile('boundary-skill', 'references/note.md', '# note')
    // A lock-shaped file that rode into .archive (a crash, or a tree archived before S4).
    await io.copy('/skills/boundary-skill', '/skills/.archive/boundary-skill')
    await io.remove('/skills/boundary-skill')
    // It is ordinary content now.
    io.files.set('/skills/.archive/boundary-skill/references/note.md.lock', deadLockBody())
    expect(await io.exists('/skills/.archive/boundary-skill/SKILL.md')).toBe(true)
    expect(await io.exists('/skills/.archive/boundary-skill/references/note.md.lock')).toBe(true)
    const restored = await lib.restoreFromArchive('boundary-skill')
    expect(restored.ok).toBe(true)
    // It is restored with the tree instead of being swept; the real support file survives too.
    expect(await io.exists('/skills/boundary-skill/references/note.md.lock')).toBe(true)
    expect(await io.readText('/skills/boundary-skill/references/note.md')).toBe('# note')
  })

  it('G2 S4: a marker-shaped `*.lock` does not refuse the archive either', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('boundary-skill', SKILL, 'foreground')
    io.files.set('/skills/boundary-skill/.pinned.lock', '4242:deadbeef')
    const archived = await lib.archive('boundary-skill')
    expect(archived.ok).toBe(true)
    expect(await io.readText('/skills/.archive/boundary-skill/.pinned.lock')).toBe('4242:deadbeef')
  })

  it('P2 (v17): create refuses atomically when the skill appears at commit time', async () => {
    // Layer a transact over the fake in which a CONCURRENT creator lands the
    // file between create's lock-free probe and the in-lock re-check — the
    // v17 fix refuses there instead of overwriting the winner.
    const base = fakeIo()
    let concurrentCreated = false
    const io: EvolutionIoLike & { files: Map<string, string> } = {
      ...base,
      files: base.files,
      async exists(path) {
        // create's early probe sees nothing; the transact re-check must catch it.
        if (!concurrentCreated && path.replaceAll('\\', '/').endsWith('/raced/SKILL.md')) return false
        return base.exists(path)
      },
      async transact(path, task) {
        if (!concurrentCreated && path.replaceAll('\\', '/').endsWith('/raced/SKILL.md')) {
          concurrentCreated = true
          // The concurrent creator uses DIFFERENT bytes: if the loser's write
          // went through, the assertion below would see 'LOSER' and fail.
          await base.writeText(path, SKILL.replace('boundary-skill', 'raced').replace('Boundary test skill.', 'WINNER description'))
        }
        const current = await base.readText(path)
        const next = await task(current)
        if (next === null) await base.remove(path)
        else if (next !== current) await base.writeText(path, next)
      },
    }
    const lib = new SkillLibrary('/skills', io)
    const created = await lib.create('raced', SKILL.replace('boundary-skill', 'raced'), 'foreground')
    expect(created.ok).toBe(false)
    expect(created.message).toContain('已存在')
    // The concurrent creator's bytes were NOT overwritten by the loser.
    expect(io.files.get('/skills/raced/SKILL.md')).toContain('WINNER description')
  })
})
