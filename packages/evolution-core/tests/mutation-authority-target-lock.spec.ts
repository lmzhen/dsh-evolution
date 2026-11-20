import { describe, expect, it } from 'vitest'
import { TargetLockSet } from '@deepseek-ai/dsh-evolution-core'
import { TargetMutationLock } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

const sleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))

describe('TargetMutationLock', () => {
  it('refuses an empty target set instead of silently unlocking', async () => {
    const home = await tempRoot('dsh-target-mutation-')
    const lock = new TargetMutationLock(new TargetLockSet(home))
    await expect(lock.acquire([])).rejects.toThrow('requires at least one target key')
  })

  it('serializes the same target key', async () => {
    const home = await tempRoot('dsh-target-mutation-')
    const lock = new TargetMutationLock(new TargetLockSet(home))
    const first = await lock.acquire(['skill::a'])
    let second = false
    const waiting = lock.acquire(['skill::a']).then(async (lease) => {
      second = true
      await lease.release()
    })
    await sleep(30)
    expect(second).toBe(false)
    await first.release()
    await waiting
    expect(second).toBe(true)
  })

  it('allows different target keys concurrently', async () => {
    const home = await tempRoot('dsh-target-mutation-')
    const lock = new TargetMutationLock(new TargetLockSet(home))
    const [a, b] = await Promise.all([lock.acquire(['skill::a']), lock.acquire(['skill::b'])])
    await a.release()
    await b.release()
  })
})
