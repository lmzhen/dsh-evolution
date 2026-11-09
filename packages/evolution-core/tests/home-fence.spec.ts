// @tier fast
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HomeFence, HomeFenceError } from '../src/home-fence.ts'
import { nodeEvolutionIo } from '../src/io.ts'

const roots: string[] = []
async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fence-'))
  roots.push(dir)
  return dir
}
afterEach(async () => { while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true }) })

describe('HomeFence', () => {
  it('serializes same-process writers', async () => {
    const home = await root()
    const fence = new HomeFence({ io: nodeEvolutionIo(), home, waitMs: 1000 })
    const order: string[] = []
    await Promise.all([
      fence.run(async () => { order.push('a-start'); await new Promise(resolve => setTimeout(resolve, 20)); order.push('a-end') }),
      fence.run(async () => { order.push('b-start'); order.push('b-end') }),
    ])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('reports busy when another live fence holds the home', async () => {
    const home = await root()
    const first = new HomeFence({ io: nodeEvolutionIo(), home, waitMs: 1000 })
    const second = new HomeFence({ io: nodeEvolutionIo(), home, waitMs: 0 })
    await expect(first.run(async () => {
      await expect(second.run(async () => {})).rejects.toBeInstanceOf(HomeFenceError)
    })).resolves.toBeUndefined()
  })

  it('releases the fence when the body throws', async () => {
    const home = await root()
    const fence = new HomeFence({ io: nodeEvolutionIo(), home, waitMs: 1000 })
    await expect(fence.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(fence.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('poisons the fence after a failed lock release instead of wedging every later writer', async () => {
    const home = await root()
    const base = nodeEvolutionIo()
    let failRelease = false
    const io = {
      ...base,
      async transact(path: string, task: (current: string | null) => Promise<string | null>): Promise<void> {
        if (failRelease && path.includes('tree-lock')) {
          const error = new Error('simulated EPERM on lock release') as Error & { code: string }
          error.code = 'EPERM'
          throw error
        }
        return await base.transact(path, task)
      },
    }
    const fence = new HomeFence({ io, home, waitMs: 1000 })
    const lease = await fence.acquire()
    failRelease = true
    await expect(lease.release()).rejects.toThrow('simulated EPERM')
    await expect(fence.acquire()).rejects.toThrow(/poisoned/)
  }, 10_000)
})
