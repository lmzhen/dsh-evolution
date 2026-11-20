import { describe, expect, it } from 'vitest'
import { SkillTargetLocks } from '../src/skill-target-locks.ts'

const sleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))

describe('SkillTargetLocks', () => {
  it('serializes the same target', async () => {
    const locks = new SkillTargetLocks()
    let active = 0
    let max = 0
    const run = async (): Promise<void> => {
      active += 1
      max = Math.max(max, active)
      await sleep(10)
      active -= 1
    }
    await Promise.all([locks.withLock('same', run), locks.withLock('same', run)])
    expect(max).toBe(1)
    expect(locks.size).toBe(0)
  })

  it('allows different targets to run concurrently', async () => {
    const locks = new SkillTargetLocks()
    let active = 0
    let max = 0
    const run = async (): Promise<void> => {
      active += 1
      max = Math.max(max, active)
      await sleep(20)
      active -= 1
    }
    await Promise.all([locks.withLock('a', run), locks.withLock('b', run)])
    expect(max).toBe(2)
  })

  it('acquires multi-target keys in lexical order regardless of caller order', async () => {
    const locks = new SkillTargetLocks()
    const order: string[] = []
    const unit = async (): Promise<void> => {
      order.push('start')
      await sleep(5)
      order.push('end')
    }
    const first = locks.withLocks(['b', 'a'], unit)
    const second = locks.withLocks(['a', 'b'], unit)
    await Promise.all([first, second])
    expect(order).toEqual(['start', 'end', 'start', 'end'])
  })

  it('deduplicates keys and leaves no queue behind', async () => {
    const locks = new SkillTargetLocks()
    await locks.withLocks(['x', 'x', 'y'], async () => {})
    expect(locks.size).toBe(0)
  })
})
