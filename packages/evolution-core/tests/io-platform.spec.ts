// @tier fast
import { describe, expect, it } from 'vitest'
import { platformEvolutionIo, type PlatformFs } from '../src/io-platform.ts'

interface Entry {
  content: string
  version: number
}

function fakeFs(): PlatformFs {
  const files = new Map<string, Entry>()
  const aliases = new Map<string, string>()
  let nextVersion = 1
  const keyOf = (path: string): string => aliases.get(path) ?? path
  const target = (path: string): { targetKey: string; displayPath: string } => ({ targetKey: keyOf(path), displayPath: path })
  const info = (key: string): { version: string; type: 'file'; size: number } | undefined => {
    const entry = files.get(key)
    return entry === undefined ? undefined : { version: String(entry.version), type: 'file', size: Buffer.byteLength(entry.content, 'utf8') }
  }
  const missing = (path: string): Error => Object.assign(new Error('missing: ' + path), { code: 'FS_NOT_FOUND' })
  const stale = (path: string): Error => Object.assign(new Error('stale: ' + path), { code: 'FS_STALE_VERSION' })
  return {
    async resolve(path) { return target(path) },
    async stat(t) { return info(t.targetKey) },
    async readText(t) { const entry = files.get(t.targetKey); if (entry === undefined) throw missing(t.displayPath); return entry.content },
    async writeText(t, content, expected) {
      const current = files.get(t.targetKey)
      if (expected?.kind === 'createIfAbsent' && current !== undefined) throw Object.assign(new Error('exists'), { code: 'FS_ALREADY_EXISTS' })
      if (expected?.kind === 'replaceIfVersion' && (current === undefined || String(current.version) !== expected.version)) throw stale(t.displayPath)
      files.set(t.targetKey, { content, version: nextVersion++ })
    },
    async editText(t, edit, expected) {
      const current = files.get(t.targetKey)
      if (current === undefined || (expected !== undefined && String(current.version) !== expected.version)) throw stale(t.displayPath)
      const count = current.content.split(edit.oldString).length - 1
      if (count !== 1) throw Object.assign(new Error('edit mismatch'), { code: 'FS_EDIT_NOT_FOUND' })
      files.set(t.targetKey, { content: current.content.replace(edit.oldString, edit.newString), version: nextVersion++ })
    },
    async deleteFile(t, expected) {
      const current = files.get(t.targetKey)
      if (current === undefined) throw missing(t.displayPath)
      if (expected !== undefined && String(current.version) !== expected.version) throw stale(t.displayPath)
      files.delete(t.targetKey)
    },
    async listDir(t) {
      const prefix = t.targetKey.replace(/\/$/, '') + '/'
      return [...files.keys()].filter(key => key.startsWith(prefix)).map(key => ({ name: key.slice(prefix.length) })).filter(name => !name.name.includes('/'))
    },
    async moveFile(source, destination) {
      const entry = files.get(source.targetKey)
      if (entry === undefined) throw missing(source.displayPath)
      files.set(destination.targetKey, entry)
      files.delete(source.targetKey)
      return { sourceDeleted: true }
    },
    async lstat(path) { return files.has(keyOf(path)) ? { type: 'file' } : undefined },
  }
}

describe('platformEvolutionIo', () => {
  it('maps read/write/list/exists/size through resolved platform targets', async () => {
    const io = platformEvolutionIo(fakeFs())
    expect(await io.readText('/skills/a/SKILL.md')).toBeNull()
    await io.writeText('/skills/a/SKILL.md', 'body')
    expect(await io.readText('/skills/a/SKILL.md')).toBe('body')
    expect(await io.exists('/skills/a/SKILL.md')).toBe(true)
    expect(await io.size('/skills/a/SKILL.md')).toBe(4)
    expect(await io.list('/skills/a')).toEqual(['SKILL.md'])
  })

  it('maps createIfAbsent contention to the write kernel EEXIST vocabulary', async () => {
    const io = platformEvolutionIo(fakeFs())
    await io.createTextIfAbsent!('/skills/a/SKILL.md', 'one')
    await expect(io.createTextIfAbsent!('/skills/a/SKILL.md', 'two')).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await io.readText('/skills/a/SKILL.md')).toBe('one')
  })

  it('transacts a present file through a guarded edit and rejects stale versions', async () => {
    const io = platformEvolutionIo(fakeFs())
    await io.writeText('/skills/a/SKILL.md', 'old')
    await io.transact!('/skills/a/SKILL.md', async current => {
      expect(current).toBe('old')
      return 'new'
    })
    expect(await io.readText('/skills/a/SKILL.md')).toBe('new')
    await expect(io.transact!('/skills/a/SKILL.md', async current => current === 'new' ? 'newer' : current)).resolves.toBeUndefined()
    expect(await io.readText('/skills/a/SKILL.md')).toBe('newer')
  })

  it('creates and deletes inside one transaction without writing a no-op', async () => {
    const io = platformEvolutionIo(fakeFs())
    await io.transact!('/skills/a/SKILL.md', async current => current === null ? 'created' : current)
    expect(await io.readText('/skills/a/SKILL.md')).toBe('created')
    await io.transact!('/skills/a/SKILL.md', async current => current === 'created' ? null : current)
    expect(await io.readText('/skills/a/SKILL.md')).toBeNull()
  })
})
