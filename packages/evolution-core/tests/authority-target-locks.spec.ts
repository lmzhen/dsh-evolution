import { describe, expect, it } from 'vitest'
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
})
