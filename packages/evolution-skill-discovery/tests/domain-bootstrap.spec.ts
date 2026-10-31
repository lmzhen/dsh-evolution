import { describe, expect, it } from 'vitest'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { bootstrapDomainMap, DomainMapFileStore, type DomainGenerationProposal } from '../src/index.ts'

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
function proposal(): DomainGenerationProposal {
  return { domains: Array.from({ length: 8 }, (_, index) => ({ title: 'domain-' + index, purpose: 'distinct purpose ' + index, inScope: ['in-' + index], outOfScope: ['out-' + index], triggers: ['trigger-' + index], evidenceSkillKeys: ['skill-' + index] })) }
}
it('bootstraps domains and edges from a validated proposal', async () => {
  const store = new DomainMapFileStore(new Io(), 'map.json', () => 1)
  const mapping = Object.fromEntries(Array.from({ length: 8 }, (_, index) => ['skill-' + index, 'key-' + index]))
  const snapshot = await bootstrapDomainMap(store, proposal(), mapping, '0')
  expect(snapshot.mapVersion).toBe('1')
  expect(snapshot.domains).toHaveLength(8)
  expect(snapshot.edges).toHaveLength(8)
  expect(snapshot.edges.every(edge => edge.role === 'primary')).toBe(true)
})
