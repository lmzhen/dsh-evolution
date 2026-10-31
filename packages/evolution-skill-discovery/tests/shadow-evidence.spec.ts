import { expect, it } from 'vitest'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { ShadowEvidenceStore } from '../src/index.ts'

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
const result = { catalogEntries: [], context: '', hiddenNames: [], shadowHiddenNames: ['a'], shadowRecoveredNames: ['a'], scope: 's', digest: 'd', complete: true }

it('promotes only after twenty persisted shadow samples', async () => {
  const io = new Io(); const store = new ShadowEvidenceStore(io, 'shadow.json')
  for (let index = 0; index < 19; index += 1) await store.record(result)
  expect(store.canPromote()).toBe(false)
  await store.record(result)
  expect(store.canPromote()).toBe(true)
  const reloaded = new ShadowEvidenceStore(io, 'shadow.json')
  await reloaded.load()
  expect(reloaded.canPromote()).toBe(true)
})


it('does not count zero-hidden or unrecovered samples as promotion evidence', async () => {
  const io = new Io(); const store = new ShadowEvidenceStore(io, 'shadow.json')
  await store.record({ ...result, shadowHiddenNames: [], shadowRecoveredNames: [] })
  expect(store.evidence().samples).toBe(0)
  for (let index = 0; index < 20; index += 1) await store.record({ ...result, shadowHiddenNames: ['a', 'b'], shadowRecoveredNames: ['a'] })
  expect(store.canPromote()).toBe(false)
})
