import { describe, expect, it } from 'vitest'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { DomainMapCorruptError, DomainMapFileStore, DomainMapValidationError, DomainMapVersionConflict, type DomainNode, type SkillDomainEdge } from '../src/index.ts'

class MemoryIo implements EvolutionIoLike {
  readonly files = new Map<string, string>()
  async readText(path: string): Promise<string | null> { return this.files.get(path) ?? null }
  async writeText(path: string, content: string): Promise<void> { this.files.set(path, content) }
  async remove(path: string): Promise<void> { this.files.delete(path) }
  async list(): Promise<string[]> { return [...this.files.keys()] }
  async exists(path: string): Promise<boolean> { return this.files.has(path) }
  async rename(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value === undefined) throw new Error('missing'); this.files.set(to, value); this.files.delete(from) }
  async copy(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value === undefined) throw new Error('missing'); this.files.set(to, value) }
}

function node(id: string): DomainNode {
  return { id, name: id, purpose: 'p', description: 'd', inScope: [], outOfScope: [], triggers: [], parentIds: [], status: 'active', version: 1, createdAt: 0, updatedAt: 0, descriptionHash: 'h', descriptionVersion: 1, descriptionStatus: 'fresh', provenance: {}, quality: {} }
}
function edge(skillKey: string, domainId: string, role: 'primary' | 'secondary' = 'primary'): SkillDomainEdge {
  return { skillKey, domainId, role, confidence: 1, source: 'manual', skillHash: 'h', mapVersion: '1', status: 'active', assignedAt: 0 }
}

describe('DomainMapFileStore', () => {
  it('reads empty, commits with CAS, and rolls back to the previous bytes', async () => {
    const io = new MemoryIo(); const path = 'map.json'; const store = new DomainMapFileStore(io, path, () => 1)
    expect(await store.read()).toMatchObject({ mapVersion: '0', domains: [], edges: [] })
    const one = await store.commit('0', { mapVersion: '1', domains: [node('a')], edges: [edge('["dsh-evolution","user-dsh","alpha"]', 'a')] })
    expect(one.mapVersion).toBe('1')
    const two = await store.commit('1', { mapVersion: '2', domains: [node('a')], edges: [edge('["dsh-evolution","user-dsh","alpha"]', 'a', 'secondary')] })
    expect(two.mapVersion).toBe('2')
    await expect(store.commit('0', { mapVersion: '3', domains: [], edges: [] })).rejects.toBeInstanceOf(DomainMapVersionConflict)
    const rolled = await store.rollback()
    expect(rolled.mapVersion).toBe('1')
    expect((await store.read()).mapVersion).toBe('1')
  })

  it('rejects corrupt files and invalid writes', async () => {
    const io = new MemoryIo(); const path = 'map.json'; io.files.set(path, 'not json')
    await expect(new DomainMapFileStore(io, path).read()).rejects.toBeInstanceOf(DomainMapCorruptError)
    const clean = new MemoryIo(); const store = new DomainMapFileStore(clean, 'map2.json', () => 1)
    await expect(store.commit('0', { mapVersion: '1', domains: [node('a')], edges: [edge('x', 'a'), edge('x', 'a', 'secondary')] })).rejects.toBeInstanceOf(DomainMapValidationError)
    await expect(store.commit('0', { mapVersion: '1', domains: [node('a')], edges: [edge('x', 'a'), edge('x', 'a')] })).rejects.toBeInstanceOf(DomainMapValidationError)
  })
})
