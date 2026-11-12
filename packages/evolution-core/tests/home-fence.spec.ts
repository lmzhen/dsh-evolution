// @tier fast
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HomeAuthority } from '../src/authority.ts'
import { HomeFence, HomeFenceError } from '../src/home-fence.ts'

/**
 * W9-authority: the fence is now a lease adapter over the authority. These tests keep the public
 * behaviour call sites depend on (serialization, a busy refusal, release on throw) and replace the
 * old poisoning test: a failed release is recorded, and later writers are not wedged.
 */

const home = (): string => mkdtempSync(join(tmpdir(), 'dsh-fence-'))
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe('HomeFence', () => {
  it('serializes same-process writers', async () => {
    const fence = new HomeFence({ home: home(), waitMs: 1_000 })
    const order: string[] = []
    await Promise.all([
      fence.run(async () => { order.push('a-start'); await sleep(20); order.push('a-end') }),
      fence.run(async () => { order.push('b-start'); order.push('b-end') }),
    ])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('reports busy when another live holder has the home', async () => {
    const dir = home()
    const first = new HomeFence({ home: dir, waitMs: 1_000 })
    const second = new HomeFence({ home: dir, waitMs: 0 })
    await expect(first.run(async () => {
      await expect(second.run(async () => {})).rejects.toBeInstanceOf(HomeFenceError)
    })).resolves.toBeUndefined()
  })

  it('releases the fence when the body throws', async () => {
    const fence = new HomeFence({ home: home(), waitMs: 1_000 })
    await expect(fence.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(fence.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('records a failed release instead of poisoning later writers', async () => {
    const lock = (async (_filename: string, operation: () => Promise<unknown>) => {
      const value = await operation()
      throw Object.assign(new Error('simulated EPERM on lock release'), { code: 'EPERM' })
      return value
    }) as unknown as NonNullable<ConstructorParameters<typeof HomeAuthority>[0]['lock']>
    const authority = new HomeAuthority({ home: home(), lock })
    const fence = new HomeFence({ home: 'unused', authority })
    await expect(fence.run(async () => 'committed')).resolves.toBe('committed')
    expect(fence.releaseFailure?.scope).toBe('tree')
    // The next writer is not wedged: the authority has no poisoned state.
    await expect(fence.run(async () => 'next')).resolves.toBe('next')
  })

  it('serves the lease form used by the mutation units', async () => {
    const dir = home()
    const first = new HomeFence({ home: dir, waitMs: 1_000 })
    const second = new HomeFence({ home: dir, waitMs: 0 })
    const lease = await first.acquire()
    await expect(second.acquire()).rejects.toBeInstanceOf(HomeFenceError)
    await lease.release()
    const again = await second.acquire()
    await again.release()
  })
})
