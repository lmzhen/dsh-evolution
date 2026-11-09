// @tier fast
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeEvolutionIo } from '../src/io.ts'
import { MutationAuthority } from '../src/mutation-authority.ts'

const roots: string[] = []
async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-authority-'))
  roots.push(dir)
  return dir
}
afterEach(async () => { while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true }) })

describe('MutationAuthority', () => {
  it('mutationLock is the one home fence and serializes its holders', async () => {
    const home = await root()
    const authority = new MutationAuthority({ io: nodeEvolutionIo(), home, waitMs: 0 })
    const first = await authority.mutationLock.acquire()
    const secondPromise = authority.mutationLock.acquire()
    const outcome = await Promise.race([
      secondPromise.then(() => 'acquired'),
      new Promise<string>(resolve => setTimeout(() => resolve('waiting'), 50)),
    ])
    expect(outcome).toBe('waiting')
    await first.release()
    const second = await secondPromise
    await second.release()
  })

  it('keeps the per-run lease independent from the write fence', async () => {
    const home = await root()
    const authority = new MutationAuthority({ io: nodeEvolutionIo(), home, waitMs: 1000 })
    const acquired = await authority.lease.acquire('foreground', 'run-1')
    expect(acquired.ok).toBe(true)
    if (!acquired.ok) return
    await expect(authority.lease.acquire('foreground', 'run-1')).resolves.toMatchObject({ ok: false })
    await authority.lease.release(acquired.token)
    const again = await authority.lease.acquire('foreground', 'run-1')
    expect(again.ok).toBe(true)
    if (again.ok) await authority.lease.release(again.token)
  })
})
