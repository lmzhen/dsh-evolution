// @tier fast
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeEvolutionIo } from '../src/io.ts'
import { LeaseStore } from '../src/lease-store.ts'

const roots: string[] = []
async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-lease-'))
  roots.push(dir)
  return dir
}
afterEach(async () => { while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true }) })

describe('LeaseStore', () => {
  it('grants one active lease per run and bumps epoch after release', async () => {
    const home = await root()
    const store = new LeaseStore({ io: nodeEvolutionIo(), home })
    const first = await store.acquire('foreground', 'run-1')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.lease.epoch).toBe(1)
    const busy = await store.acquire('background_review', 'run-1')
    expect(busy.ok).toBe(false)
    if (busy.ok) return
    expect(busy.reason).toBe('busy')
    await store.release(first.token)
    const second = await store.acquire('foreground', 'run-1')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.lease.epoch).toBe(2)
  })

  it('reclaims an expired lease and refuses stale token renewal', async () => {
    const home = await root()
    let now = 1000
    const store = new LeaseStore({ io: nodeEvolutionIo(), home, now: () => now, ttlMs: 100 })
    const first = await store.acquire('foreground', 'run-2')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    now = 1200
    expect(await store.active('run-2')).toBeNull()
    const second = await store.acquire('background_review', 'run-2')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.lease.epoch).toBe(2)
    expect(await store.renew(first.token)).toBeNull()
  })

  it('renews a live lease with the same epoch', async () => {
    const home = await root()
    let now = 1000
    const store = new LeaseStore({ io: nodeEvolutionIo(), home, now: () => now, ttlMs: 100 })
    const acquired = await store.acquire('foreground', 'run-3')
    expect(acquired.ok).toBe(true)
    if (!acquired.ok) return
    now = 1050
    const renewed = await store.renew(acquired.token)
    expect(renewed?.epoch).toBe(acquired.lease.epoch)
    expect(renewed?.expiresAt).toBe(1150)
  })

  it('serializes concurrent acquire attempts', async () => {
    const home = await root()
    const store = new LeaseStore({ io: nodeEvolutionIo(), home })
    const results = await Promise.all([
      store.acquire('foreground', 'run-4'),
      store.acquire('background_review', 'run-4'),
    ])
    expect(results.filter(result => result.ok)).toHaveLength(1)
  })
})
