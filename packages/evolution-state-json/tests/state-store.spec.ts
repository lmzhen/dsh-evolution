// @tier fast
import { expect, it } from 'vitest'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionCollection } from '@deepseek-ai/dsh-evolution-contract'
import { JsonStateStore } from '../src/index.ts'

class Io implements EvolutionIoLike {
  files = new Map<string, string>()
  async readText(path: string): Promise<string | null> { return this.files.get(path) ?? null }
  async writeText(path: string, content: string): Promise<void> { this.files.set(path, content) }
  async remove(path: string): Promise<void> { this.files.delete(path) }
  async list(): Promise<string[]> { return [...this.files.keys()] }
  async exists(path: string): Promise<boolean> { return this.files.has(path) }
  async rename(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) { this.files.set(to, value); this.files.delete(from) } }
  async copy(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) this.files.set(to, value) }
}

const collection = 'assignment-queue' as EvolutionCollection

it('reads, transacts and lists one collection', async () => {
  const store = new JsonStateStore(new Io(), 'root')
  expect(await store.read(collection, 'k')).toBeUndefined()
  await store.transact(collection, 'k', async () => ({ n: 1 }))
  expect(await store.read(collection, 'k')).toEqual({ n: 1 })
  expect(await store.list(collection)).toEqual([{ n: 1 }])
})

it('serializes concurrent transactions without losing an update', async () => {
  const store = new JsonStateStore(new Io(), 'root')
  await Promise.all([
    store.transact<{ n: number }>(collection, 'counter', async current => ({ n: (current?.n ?? 0) + 1 })),
    store.transact<{ n: number }>(collection, 'counter', async current => ({ n: (current?.n ?? 0) + 1 })),
  ])
  expect(await store.read(collection, 'counter')).toEqual({ n: 2 })
})