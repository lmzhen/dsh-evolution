// @tier fast
import { describe, expect, it } from 'vitest'
import type { EvolutionCollection, EvolutionStateStore } from '../src/index.ts'

class MemoryStateStore implements EvolutionStateStore {
  private readonly values = new Map<string, unknown>()
  private chain: Promise<unknown> = Promise.resolve()
  async read<T>(collection: EvolutionCollection, key: string): Promise<T | undefined> {
    return this.values.get(collection + '/' + key) as T | undefined
  }
  transact<T>(collection: EvolutionCollection, key: string, fn: (current: T | undefined) => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const current = this.values.get(collection + '/' + key) as T | undefined
      const next = await fn(current)
      this.values.set(collection + '/' + key, next)
      return next
    })
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }
  async list<T>(collection: EvolutionCollection): Promise<T[]> {
    return [...this.values.entries()].filter(([key]) => key.startsWith(collection + '/')).map(([, value]) => value as T)
  }
}

const collection = 'review' as EvolutionCollection

describe('EvolutionStateStore contract', () => {
  it('distinguishes an absent record from a stored one', async () => {
    const store = new MemoryStateStore()
    expect(await store.read(collection, 'missing')).toBeUndefined()
    await store.transact(collection, 'a', async () => ({ n: 1 }))
    expect(await store.read(collection, 'a')).toEqual({ n: 1 })
  })

  it('serializes concurrent transactions on one key', async () => {
    const store = new MemoryStateStore()
    await Promise.all([
      store.transact<{ n: number }>(collection, 'counter', async current => ({ n: (current?.n ?? 0) + 1 })),
      store.transact<{ n: number }>(collection, 'counter', async current => ({ n: (current?.n ?? 0) + 1 })),
    ])
    expect(await store.read(collection, 'counter')).toEqual({ n: 2 })
  })

  it('lists one collection without leaking another', async () => {
    const store = new MemoryStateStore()
    await store.transact(collection, 'a', async () => ({ id: 'a' }))
    await store.transact('other' as EvolutionCollection, 'b', async () => ({ id: 'b' }))
    expect(await store.list(collection)).toEqual([{ id: 'a' }])
  })
})