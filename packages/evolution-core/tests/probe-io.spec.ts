import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMissingPath, isUnknown, nodeEvolutionIo, probeList, probeMtime, probeReason } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

/** An IO seam whose list/mtime throw the given error for one path. */
function failingIo(base: EvolutionIoLike, failures: Map<string, unknown>): EvolutionIoLike {
  const key = (path: string) => path.replaceAll('\\', '/')
  return {
    ...base,
    async list(path) {
      const failure = failures.get(key(path))
      if (failure !== undefined) throw failure
      return base.list(path)
    },
    async mtime(path) {
      const failure = failures.get(key(path))
      if (failure !== undefined) throw failure
      return base.mtime ? base.mtime(path) : null
    },
  }
}

const eacces = (path: string): NodeJS.ErrnoException => Object.assign(new Error(`EACCES: permission denied, scandir '${path}'`), { code: 'EACCES' })

describe('three-state IO reads (B3 / N14)', () => {
  it('probeList: the node backend answers an EMPTY listing for a missing directory (rc.50 P2-4)', async () => {
    const root = await tempRoot('dsh-evo-probe-')
    expect(await probeList(nodeEvolutionIo(), join(root, 'not-there'))).toEqual({ kind: 'present', value: [] })
  })

  it('probeList: a backend that THROWS ENOENT reads as absent, not as empty', async () => {
    const root = await tempRoot('dsh-evo-probe-')
    const io = nodeEvolutionIo()
    const strict: EvolutionIoLike = {
      ...io,
      async list(path) {
        if (!(await io.exists(path))) {
          throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${path}'`), { code: 'ENOENT' })
        }
        return io.list(path)
      },
    }
    expect(await probeList(strict, join(root, 'not-there'))).toEqual({ kind: 'absent' })
  })

  it('probeList: an UNREADABLE directory is unknown with the reason, not absent', async () => {
    const root = await tempRoot('dsh-evo-probe-')
    const dir = join(root, 'locked')
    await mkdir(dir, { recursive: true })
    const io = failingIo(nodeEvolutionIo(), new Map([[dir.replaceAll('\\', '/'), eacces(dir)]]))
    const probe = await probeList(io, dir)
    expect(probe.kind).toBe('unknown')
    expect(isUnknown(probe) && probe.reason).toContain('EACCES')
  })

  it('probeList: a readable directory yields its entries', async () => {
    const root = await tempRoot('dsh-evo-probe-')
    await mkdir(join(root, 'here'), { recursive: true })
    await writeFile(join(root, 'here', 'a.txt'), 'a')
    const probe = await probeList(nodeEvolutionIo(), join(root, 'here'))
    expect(probe).toEqual({ kind: 'present', value: ['a.txt'] })
  })

  it('probeMtime: present for a real file, absent for a missing one', async () => {
    const root = await tempRoot('dsh-evo-probe-')
    await writeFile(join(root, 'stamp.txt'), 'x')
    const io = nodeEvolutionIo()
    expect((await probeMtime(io, join(root, 'stamp.txt'))).kind).toBe('present')
    expect(await probeMtime(io, join(root, 'stamp.txt'))).toMatchObject({ kind: 'present' })
    expect(await probeMtime(io, join(root, 'gone.txt'))).toEqual({ kind: 'absent' })
  })

  it('probeMtime: a stat that FAILS is unknown — the missing/unreadable split', async () => {
    const root = await tempRoot('dsh-evo-probe-')
    const file = join(root, 'held.txt')
    await writeFile(file, 'x')
    const io = failingIo(nodeEvolutionIo(), new Map([[file.replaceAll('\\', '/'), eacces(file)]]))
    const probe = await probeMtime(io, file)
    expect(probe.kind).toBe('unknown')
    expect(isUnknown(probe) && probe.reason).toContain('EACCES')
  })

  it('isMissingPath separates ENOENT/ENOTDIR from every other failure', () => {
    expect(isMissingPath(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(true)
    expect(isMissingPath(Object.assign(new Error('x'), { code: 'ENOTDIR' }))).toBe(true)
    expect(isMissingPath(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false)
    expect(isMissingPath(new Error('no code'))).toBe(false)
    expect(probeReason(new Error('boom'))).toBe('boom')
    expect(probeReason('plain')).toBe('plain')
  })
})
