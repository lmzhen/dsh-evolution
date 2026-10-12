/**
 * G2 S3 drills: the platform provider's optimistic RMW. Each case is a defect that MUST go red if the
 * retry logic regresses — a stale write must not silently overwrite, a failed task must not write at
 * all, and two concurrent read-modify-writes must not lose an update.
 */
import { describe, expect, it } from 'vitest'
import { platformEvolutionIo } from '../src/index.ts'

/** In-memory platform filesystem with real version semantics and injectable conflicts. */
function guardedFs(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed))
  const versions = new Map([...files.keys()].map(k => [k, 1]))
  let onWrite: ((path: string) => void) | undefined
  return {
    files,
    versions,
    /** Let a test interleave a foreign writer between the read and the guarded write. */
    beforeWrite(hook: (path: string) => void) { onWrite = hook },
    async resolve(path: string) { return { path } },
    async stat(target: unknown) {
      const path = (target as { path: string }).path
      const text = files.get(path)
      if (text === undefined) return undefined
      return { size: Buffer.byteLength(text, 'utf8'), version: versions.get(path) ?? 1 }
    },
    async lstat(path: string) { return files.has(path) ? { symlink: false } : undefined },
    async readText(target: unknown) {
      const path = (target as { path: string }).path
      const text = files.get(path)
      if (text === undefined) { const error = new Error('missing') as Error & { code?: string }; error.code = 'FS_NOT_FOUND'; throw error }
      return text
    },
    async listDir() { return [...files.keys()].map(name => ({ name })) },
    async writeText(target: unknown, content: string, expected?: { kind: string; version?: unknown }) {
      const path = (target as { path: string }).path
      onWrite?.(path)
      const present = files.has(path)
      if (expected?.kind === 'createIfAbsent' && present) { const e = new Error('exists') as Error & { code?: string }; e.code = 'FS_NOT_OBSERVED'; throw e }
      if (expected?.kind === 'replaceIfVersion' && (!present || versions.get(path) !== expected.version)) {
        const e = new Error('stale') as Error & { code?: string }; e.code = 'FS_STALE_VERSION'; throw e
      }
      files.set(path, content)
      versions.set(path, (versions.get(path) ?? 0) + 1)
    },
  }
}

const ctxWith = (fs: unknown) => ({ get: (name: string) => (name === 'fs' ? fs : undefined) })

describe('G2 S3: optimistic RMW (CAS retry, not a second lock)', () => {
  it('re-runs the task on fresh content when a foreign writer wins the race', async () => {
    const fs = guardedFs({ '/a.txt': 'one\n' })
    let interleaved = false
    fs.beforeWrite((path) => {
      if (interleaved) return
      interleaved = true
      // A foreign writer commits between our read and our guarded write.
      fs.files.set(path, 'one\nforeign\n')
      fs.versions.set(path, (fs.versions.get(path) ?? 0) + 1)
    })
    const io = platformEvolutionIo(ctxWith(fs))
    await io.transact?.('/a.txt', current => (current ?? '') + 'mine\n')
    expect(fs.files.get('/a.txt')).toBe('one\nforeign\nmine\n')
  })

  it('surfaces the conflict when the attempt budget is 1', async () => {
    const fs = guardedFs({ '/b.txt': 'x\n' })
    fs.beforeWrite((path) => { fs.files.set(path, 'other\n'); fs.versions.set(path, (fs.versions.get(path) ?? 0) + 1) })
    const io = platformEvolutionIo(ctxWith(fs), { attempts: 1 })
    await expect(io.transact?.('/b.txt', current => (current ?? '') + 'mine\n')).rejects.toThrow(/stale/)
  })

  it('writes nothing when the task throws', async () => {
    const fs = guardedFs({ '/c.txt': 'keep\n' })
    let writes = 0
    fs.beforeWrite(() => { writes += 1 })
    const io = platformEvolutionIo(ctxWith(fs))
    await expect(io.transact?.('/c.txt', () => { throw new Error('task failed') })).rejects.toThrow('task failed')
    expect(writes).toBe(0)
    expect(fs.files.get('/c.txt')).toBe('keep\n')
  })

  it('creates with createIfAbsent and upgrades to replaceIfVersion after a concurrent create', async () => {
    const fs = guardedFs()
    let raced = false
    fs.beforeWrite((path) => {
      if (raced) return
      raced = true
      fs.files.set(path, 'theirs\n')
      fs.versions.set(path, 1)
    })
    const io = platformEvolutionIo(ctxWith(fs))
    await io.transact?.('/d.txt', current => (current === null ? 'mine\n' : current + 'mine\n'))
    expect(fs.files.get('/d.txt')).toBe('theirs\nmine\n')
  })

  it('deletes through the declared fallback (the platform has no remove)', async () => {
    const fs = guardedFs({ '/e.txt': '' })
    const io = platformEvolutionIo(ctxWith(fs))
    await Promise.all([
      io.transact?.('/e.txt', async (current) => { await new Promise(r => setTimeout(r, 1)); return (current ?? '') + 'A\n' }),
      io.transact?.('/e.txt', async (current) => { await new Promise(r => setTimeout(r, 1)); return (current ?? '') + 'B\n' }),
    ])
    const text = fs.files.get('/e.txt') ?? ''
    expect(text.includes('A\n')).toBe(true)
    expect(text.includes('B\n')).toBe(true)
  })

  it('deletes through the declared fallback (the platform has no remove)', async () => {
    const { mkdtemp, writeFile, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'evo-io-fs-delete-'))
    const file = join(dir, 'gone.txt')
    await writeFile(file, 'delete me', 'utf8')
    // The fake platform filesystem never sees the delete: the node fallback owns it (the C2 gap list
    // names `remove`, and this drill is what keeps that declaration honest).
    const fs = guardedFs()
    const io = platformEvolutionIo(ctxWith(fs))
    await io.transact?.(file, () => null)
    await expect(readFile(file, 'utf8')).rejects.toThrow(/ENOENT/)
  })
})

