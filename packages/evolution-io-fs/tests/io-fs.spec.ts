/**
 * G2 S0: the platform `ctx.fs` provider — what it maps, and what it declares as a gap.
 *
 * The spec runs against a STRUCTURAL fake of the platform filesystem: the point of S0 is the
 * mapping and the declared fallbacks, not the platform's own behaviour (that is the platform's
 * suite). `apply()` is deliberately not exercised here — it needs a real cordis context and its
 * only S0 promise is 'registered, NOT default', which the registry's own spec covers.
 */
import { describe, expect, it } from 'vitest'
import { PLATFORM_IO_FALLBACKS, PROVIDER_NAME, platformEvolutionIo, providerFor } from '../src/index.ts'

/** An in-memory stand-in for the platform FileSystem surface this provider declares. */
function fakeFs(seed: Record<string, string> = {}, options: { readFailsOn?: string } = {}) {
  const files = new Map(Object.entries(seed))
  const dirs = new Map<string, string[]>([['/', [...files.keys()]]])
  return {
    files,
    async resolve(path: string) {
      return { path }
    },
    async stat(target: unknown) {
      const path = (target as { path: string }).path
      const text = files.get(path)
      return text === undefined ? undefined : { size: Buffer.byteLength(text, 'utf8') }
    },
    async lstat(path: string) {
      return files.has(path) ? { symlink: false } : undefined
    },
    async readText(target: unknown) {
      const path = (target as { path: string }).path
      if (options.readFailsOn === path) throw new Error('boom: unreadable')
      const text = files.get(path)
      if (text === undefined) throw new Error('ENOENT')
      return text
    },
    async listDir(target: unknown) {
      const path = (target as { path: string }).path
      return (dirs.get(path) ?? []).map(name => ({ name }))
    },
    async writeText(target: unknown, content: string) {
      files.set((target as { path: string }).path, content)
      dirs.set('/', [...files.keys()])
    },
  }
}

const ctxWith = (fs: unknown) => ({ get: (name: string) => (name === 'fs' ? fs : undefined) })

describe('platformEvolutionIo (G2 S0)', () => {
  it('maps read/write/exists/size/list onto the platform filesystem', async () => {
    const fs = fakeFs({ '/home/a.txt': 'hello' })
    const io = platformEvolutionIo(ctxWith(fs))
    expect(await io.readText('/home/a.txt')).toBe('hello')
    expect(await io.readText('/home/missing.txt')).toBeNull()
    expect(await io.exists('/home/a.txt')).toBe(true)
    expect(await io.exists('/home/missing.txt')).toBe(false)
    expect(await io.size('/home/a.txt')).toBe(5)
    expect(await io.list('/')).toEqual(['/home/a.txt'])
    await io.writeText('/home/b.txt', 'written')
    expect(await io.readText('/home/b.txt')).toBe('written')
  })

  it('keeps a real read failure an error, not a missing file', async () => {
    const fs = fakeFs({ '/home/broken.txt': 'x' }, { readFailsOn: '/home/broken.txt' })
    const io = platformEvolutionIo(ctxWith(fs))
    await expect(io.readText('/home/broken.txt')).rejects.toThrow('boom: unreadable')
  })

  it('refuses to build when the platform fs service is absent (fail loud, no silent second stack)', () => {
    expect(() => platformEvolutionIo({ get: () => undefined })).toThrow(/fs service is not mounted/)
    expect(() => platformEvolutionIo(ctxWith({ resolve: async () => ({}) }))).toThrow(/fs service is not mounted/)
  })

  it('declares its gaps as data: exactly the three mutations the platform surface lacks', () => {
    const io = platformEvolutionIo(ctxWith(fakeFs()))
    expect([...PLATFORM_IO_FALLBACKS]).toEqual(['remove', 'rename', 'copy'])
    for (const method of PLATFORM_IO_FALLBACKS) expect(typeof io[method]).toBe('function')
    // The fallbacks really are the node backend: a write through it is readable through it.
    expect(PROVIDER_NAME).toBe('fs')
    expect(providerFor(ctxWith(fakeFs())).name).toBe('fs')
  })
})
