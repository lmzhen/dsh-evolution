import { describe, expect, it } from 'vitest'
import { SkillLibrary, isUnknown, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { fakeIo } from '../../test-support/fake-io.ts'

const SKILL = '---\nname: three-state\ndescription: Three state reads.\n---\n\n# Body\n'
const norm = (path: string) => path.replaceAll('\\', '/')

/** Make one directory listing fail the way a real unreadable directory does. */
function lockListing(io: EvolutionIoLike, path: string, code = 'EACCES'): void {
  const original = io.list.bind(io)
  io.list = async (candidate: string) => {
    if (norm(candidate) === norm(path)) throw Object.assign(new Error(`${code}: permission denied, scandir '${candidate}'`), { code })
    return original(candidate)
  }
}

describe('skill-store read three-state (B3 / N14)', () => {
  it('listSupportFiles: the present branch carries the complete list', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('three-state', SKILL, 'foreground')
    await lib.writeSupportFile('three-state', 'references/a.md', '# A')
    expect(await lib.listSupportFiles('three-state')).toEqual({ kind: 'present', value: ['references/a.md'] })
  })

  it('listSupportFiles: an UNREADABLE skill directory is unknown, not an empty list', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('three-state', SKILL, 'foreground')
    lockListing(io, '/skills/three-state')
    const probe = await lib.listSupportFiles('three-state')
    expect(probe.kind).toBe('unknown')
    expect(isUnknown(probe) && probe.reason).toContain('EACCES')
    // The richness counter degrades to 0 on the same read, and it says so by
    // being a DIFFERENT call, never by a swallowed catch inside the reader.
    expect(await lib.countSupportDirs('three-state')).toBe(0)
  })

  it('listSupportFiles: a partial listing is unknown too (a subdir we cannot read)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('three-state', SKILL, 'foreground')
    await lib.writeSupportFile('three-state', 'references/a.md', '# A')
    lockListing(io, '/skills/three-state/references')
    const probe = await lib.listSupportFiles('three-state')
    expect(probe.kind).toBe('unknown')
    // No partial list leaks out as if it were complete.
    // The unknown variant carries no value AT ALL (not an empty one): `value`
    // is not a key of it, so nothing can be read as if it were a short list.
    expect('value' in probe).toBe(false)
  })

  it('a missing directory reads as an EMPTY listing on the node backend, and the restore says so', async () => {
    const root = await tempRoot('dsh-evo-three-state-')
    const lib = new SkillLibrary(root, nodeEvolutionIo())
    // rc.50 P2-4: the backend maps a missing directory to [], so "nothing is
    // there" is present-but-empty HERE and never reaches the unknown branch.
    expect(await lib.listSupportFiles('no-such-skill')).toEqual({ kind: 'present', value: [] })
    expect(await lib.listSnapshots()).toEqual({ kind: 'present', value: [] })
    expect(await lib.restoreLatestSnapshot()).toEqual({ ok: false, message: 'No skill snapshot available.' })
  })

  it('listSupportFiles / listSnapshots: a backend that throws ENOENT reads as absent', async () => {
    const root = await tempRoot('dsh-evo-three-state-')
    const base = nodeEvolutionIo()
    const strict: EvolutionIoLike = {
      ...base,
      async list(path: string) {
        if (!(await base.exists(path))) {
          throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${path}'`), { code: 'ENOENT' })
        }
        return base.list(path)
      },
    }
    const lib = new SkillLibrary(root, strict)
    expect(await lib.listSupportFiles('no-such-skill')).toEqual({ kind: 'absent' })
    expect(await lib.listSnapshots()).toEqual({ kind: 'absent' })
  })

  it('listSnapshots: an unreadable .backups is unknown, and the restore refuses with the reason', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    await lib.create('three-state', SKILL, 'foreground')
    await lib.snapshotAll('pre-test')
    lockListing(io, '/skills/.backups')
    const probe = await lib.listSnapshots()
    expect(probe.kind).toBe('unknown')
    const restored = await lib.restoreLatestSnapshot()
    expect(restored.ok).toBe(false)
    expect(restored.message).toContain('could not be read')
    expect(restored.message).toContain('EACCES')
    // A failed listing never reaches the destructive clear.
    expect(restored.message).toContain('nothing was changed')
    expect(await io.exists('/skills/three-state/SKILL.md')).toBe(true)
  })
})
