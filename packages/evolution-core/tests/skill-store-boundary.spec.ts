import { describe, expect, it } from 'vitest'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

function fakeIo(): EvolutionIoLike & { files: Map<string, string> } {
  const files = new Map<string, string>()
  const normalize = (path: string) => path.replaceAll('\\', '/')
  const children = (path: string) => {
    const prefix = normalize(path).replace(/[\\/]+$/, '') + '/'
    const names = new Set<string>()
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const name = rest.split('/')[0]
      if (name) names.add(name)
    }
    return [...names]
  }
  const removePrefix = (path: string) => {
    const prefix = normalize(path).replace(/[\\/]+$/, '') + '/'
    for (const key of [...files.keys()]) {
      if (key === normalize(path) || key.startsWith(prefix)) files.delete(key)
    }
  }
  return {
    files,
    async readText(path) { return files.get(normalize(path)) ?? null },
    async writeText(path, content) { files.set(normalize(path), content) },
    async remove(path) { removePrefix(path) },
    async list(path) { return children(path) },
    async exists(path) {
      const key = normalize(path)
      if (files.has(key)) return true
      const prefix = key.replace(/\/$/, '') + '/'
      return [...files.keys()].some(file => file.startsWith(prefix))
    },
    async rename(_path, _destination) { throw new Error('rename unsupported') },
    async copy(path, destination) {
      const prefix = normalize(path).replace(/[\\/]+$/, '') + '/'
      const destPrefix = normalize(destination).replace(/\/$/, '') + '/'
      for (const [key, value] of files) {
        if (key === normalize(path) || key.startsWith(prefix)) {
          const suffix = key === normalize(path) ? key.slice(key.lastIndexOf('/') + 1) : key.slice(prefix.length)
          files.set(destPrefix + suffix, value)
        }
      }
    },
    // G7 fake: the probe answers per-entry symlink-ness (default: not a link).
    async isSymlink(path) {
      const key = normalize(path)
      return files.get(`${key}.symlink`) === 'true'
    },
  }
}

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
    expect(result.message).toContain('symlink')
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
