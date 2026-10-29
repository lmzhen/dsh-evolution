// @tier fast
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileMutationLock, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

class MemoryIo implements EvolutionIoLike {
  readonly files = new Map<string, string>()
  async readText(path: string): Promise<string | null> { return this.files.get(path) ?? null }
  async writeText(path: string, content: string): Promise<void> { this.files.set(path, content) }
  async remove(path: string): Promise<void> { this.files.delete(path) }
  async list(): Promise<string[]> { return [] }
  async exists(path: string): Promise<boolean> { return this.files.has(path) }
  async rename(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) { this.files.delete(from); this.files.set(to, value) } }
  async copy(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) this.files.set(to, value) }
}

const ROOT = 'D:/skills'
const PATH = join(dirname(ROOT), '.' + basename(ROOT) + '.mutation-lock')

describe('fileMutationLock', () => {
  it('acquires, blocks a live holder, releases, and reacquires', async () => {
    const io = new MemoryIo()
    const lock = fileMutationLock(io, ROOT, { waitMs: 20, pollMs: 1, sleep: async () => {} })
    const first = await lock.acquire()
    expect(io.files.get(PATH)).toContain('"pid"')
    await expect(lock.acquire()).rejects.toThrow('mutation-lock-busy')
    await first.release()
    expect(io.files.has(PATH)).toBe(false)
    const second = await lock.acquire()
    await second.release()
  })

  it('takes over a dead pid record', async () => {
    const io = new MemoryIo()
    io.files.set(PATH, JSON.stringify({ token: 'stale', pid: 999999, startedAt: 0 }))
    const lock = fileMutationLock(io, ROOT, { waitMs: 20, pollMs: 1, sleep: async () => {} })
    const lease = await lock.acquire()
    expect(io.files.get(PATH)).not.toContain('"stale"')
    await lease.release()
  })
})
