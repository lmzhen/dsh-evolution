// @tier fast
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { TargetLockSet } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

const sleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))

describe('TargetLockSet', () => {
  it('serializes the same target key', async () => {
    const home = await tempRoot('dsh-target-locks-')
    const locks = new TargetLockSet(home)
    let active = 0
    let max = 0
    const body = async (): Promise<void> => {
      active += 1
      max = Math.max(max, active)
      await sleep(10)
      active -= 1
    }
    await Promise.all([locks.run(['skill::a'], body), locks.run(['skill::a'], body)])
    expect(max).toBe(1)
    expect(locks.size).toBe(0)
  })

  it('allows different target keys to run concurrently', async () => {
    const home = await tempRoot('dsh-target-locks-')
    const locks = new TargetLockSet(home)
    let active = 0
    let max = 0
    const body = async (): Promise<void> => {
      active += 1
      max = Math.max(max, active)
      await sleep(30)
      active -= 1
    }
    await Promise.all([locks.run(['skill::a'], body), locks.run(['skill::b'], body)])
    expect(max).toBe(2)
  })

  it('takes multiple keys in lexical order without deadlocking', async () => {
    const home = await tempRoot('dsh-target-locks-')
    const locks = new TargetLockSet(home)
    const order: string[] = []
    const body = async (): Promise<void> => {
      order.push('start')
      await sleep(5)
      order.push('end')
    }
    await Promise.all([
      locks.run(['skill::b', 'skill::a'], body),
      locks.run(['skill::a', 'skill::b'], body),
    ])
    expect(order).toEqual(['start', 'end', 'start', 'end'])
  })
  it('exposes an acquire/release lease for unit lock ports', async () => {
    const home = await tempRoot('dsh-target-locks-')
    const locks = new TargetLockSet(home)
    const first = await locks.acquireLease(['skill::a'])
    let secondAcquired = false
    const second = locks.acquireLease(['skill::a']).then(async (lease) => {
      secondAcquired = true
      await lease.release()
    })
    await sleep(40)
    expect(secondAcquired).toBe(false)
    await first.release()
    await second
    expect(secondAcquired).toBe(true)
  })

  it('releases all keys on a multi-key lease', async () => {
    const home = await tempRoot('dsh-target-locks-')
    const locks = new TargetLockSet(home)
    const lease = await locks.acquireLease(['skill::b', 'skill::a'])
    await lease.release()
    const next = await locks.acquireLease(['skill::a', 'skill::b'])
    await next.release()
    expect(locks.size).toBe(0)
  })

  it('A4: repair honors an existing takeover claim and rechecks the record', async () => {
    const home = await tempRoot('dsh-target-locks-claim-')
    let lockPath = ''
    const failing = async (path: string, body: () => Promise<unknown>): Promise<void> => {
      lockPath = path + '.lock'
      await writeFile(lockPath, String(process.pid) + '\n', 'utf8')
      await body()
      throw new Error('release-failed')
    }
    const locks = new TargetLockSet(home, 5_000, failing as never)
    const first = await locks.acquireLease(['skill::a'])
    await first.release()
    const dead = '999999\n'
    await writeFile(lockPath, dead, 'utf8')
    const claim = lockPath + '.takeover-' + createHash('sha256').update(dead).digest('hex').slice(0, 16)
    await writeFile(claim, 'other-contender\n', 'utf8')
    try {
      const blocked = await locks.repair()
      expect(blocked.skipped).toContain('skill::a')
      expect(await readFile(lockPath, 'utf8')).toBe(dead)
    } finally {
      await rm(claim, { force: true })
    }
    const repaired = await locks.repair()
    expect(repaired.repaired).toContain('skill::a')
    await expect(readFile(lockPath, 'utf8')).rejects.toThrow()
  })

  it('does not wedge a key when lock release itself fails', async () => {
    const home = await tempRoot('dsh-target-locks-')
    let lockPath = ''
    const failing = async (path: string, body: () => Promise<unknown>): Promise<void> => {
      const { writeFile } = await import('node:fs/promises')
      lockPath = path + '.lock'
      await writeFile(lockPath, `${process.pid}\n`, 'utf8')
      await body()
      throw new Error('release-failed')
    }
    const locks = new TargetLockSet(home, 5_000, failing as never)
    const first = await locks.acquireLease(['skill::a'])
    await first.release()
    expect(locks.lastReleaseError?.message).toContain('release-failed')
    const repaired = await locks.repair()
    expect(repaired.repaired).toContain('skill::a')
    await expect(import('node:fs/promises').then(fs => fs.stat(lockPath))).rejects.toThrow()
    const second = await locks.acquireLease(['skill::a'])
    await second.release()
    expect(locks.size).toBe(0)
  })

})
