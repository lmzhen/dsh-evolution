// @tier pre-tag
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireTreeWriteLock,
  nodeEvolutionIo,
  readTreeLock,
  treeLockFile,
  withTreeWriteLock,
} from '../src/index.ts'

const roots: string[] = []
async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tree-lock-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
})

describe('tree write lock', () => {
  it('serializes holders and releases exactly once', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    const first = await acquireTreeWriteLock({ io, home: dir, waitMs: 0 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = await acquireTreeWriteLock({ io, home: dir, waitMs: 30, pollMs: 5 })
    expect(second).toMatchObject({ ok: false, reason: 'busy' })
    if (!second.ok) expect(second.holder?.token).toBe(first.lock.token)
    await first.lock.release()
    await first.lock.release()
    expect(await readTreeLock(io, dir)).toBeUndefined()
    const third = await acquireTreeWriteLock({ io, home: dir, waitMs: 0 })
    expect(third.ok).toBe(true)
    if (third.ok) await third.lock.release()
  })

  it('takes over a dead holder and a corrupt record', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    await mkdir(dirname(treeLockFile(dir)), { recursive: true })
    await writeFile(treeLockFile(dir), JSON.stringify({ token: 'dead', pid: 999_999, startedAt: 1 }), 'utf8')
    const dead = await acquireTreeWriteLock({ io, home: dir, waitMs: 0 })
    expect(dead.ok).toBe(true)
    if (dead.ok) {
      expect(dead.lock.token).not.toBe('dead')
      await dead.lock.release()
    }
    await writeFile(treeLockFile(dir), 'not-json', 'utf8')
    const corrupt = await acquireTreeWriteLock({ io, home: dir, waitMs: 0 })
    expect(corrupt.ok).toBe(true)
    if (corrupt.ok) await corrupt.lock.release()
  })

  it('does not release a lock it does not own', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    const held = await acquireTreeWriteLock({ io, home: dir, waitMs: 0 })
    expect(held.ok).toBe(true)
    if (!held.ok) return
    const foreign = await acquireTreeWriteLock({ io, home: dir, waitMs: 0 })
    expect(foreign.ok).toBe(false)
    await held.lock.release()
    expect(await readTreeLock(io, dir)).toBeUndefined()
  })

  it('releases on a thrown body and surfaces the body error', async () => {
    const dir = await home()
    const io = nodeEvolutionIo()
    await expect(withTreeWriteLock({ io, home: dir }, async () => {
      throw new Error('body-boom')
    })).rejects.toThrow('body-boom')
    expect(await readTreeLock(io, dir)).toBeUndefined()
  })
})
