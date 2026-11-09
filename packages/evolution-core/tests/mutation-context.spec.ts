// @tier fast
import { describe, expect, it } from 'vitest'
import { MutationUnit, type EvolutionIoLike, type MutationSnapshotPort } from '../src/mutation-unit.ts'

class MemoryIo implements EvolutionIoLike {
  readonly files = new Map<string, string>()
  async readText(path: string): Promise<string | null> { return this.files.get(path) ?? null }
  async writeText(path: string, content: string): Promise<void> { this.files.set(path, content) }
  async remove(path: string): Promise<void> { this.files.delete(path) }
  async list(): Promise<string[]> { return [] }
  async exists(path: string): Promise<boolean> { return this.files.has(path) }
  async rename(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) { this.files.delete(from); this.files.set(to, value) } }
  async copy(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) this.files.set(to, value) }
}

class Snapshots implements MutationSnapshotPort {
  readonly items = new Map<string, Parameters<MutationSnapshotPort['write']>[0]>()
  async write(snapshot: Parameters<MutationSnapshotPort['write']>[0]): Promise<void> { this.items.set(snapshot.unitId, snapshot) }
  async read(unitId: string): Promise<Parameters<MutationSnapshotPort['write']>[0] | null> { return this.items.get(unitId) ?? null }
  async listPrepared() { return [] }
}

describe('MutationUnit context provenance', () => {
  it('stamps owner, runId, leaseId on prepared and committed snapshots', async () => {
    const io = new MemoryIo()
    io.files.set('skill/SKILL.md', 'old')
    const snapshots = new Snapshots()
    const unit = new MutationUnit({ nested: true,
      io,
      limits: { maxSkillFileBytes: 1000, maxSkillContentChars: 1000 },
      snapshots,
      context: { owner: 'background_review', runId: 'review-1', leaseId: 'lease-1' },
    })
    const result = await unit.apply({
      name: 'skill',
      roots: [{ name: 'skill', protection: 'write' }],
      ops: [{ kind: 'write', target: 'skill/SKILL.md', content: 'new', expected: 'old', skill: 'skill' }],
      origin: 'background_review',
      auditAction: 'write',
      auditSummary: 'provenance',
      eventAction: 'write',
    })
    expect(result.ok).toBe(true)
    expect([...snapshots.items.values()][0]).toMatchObject({ owner: 'background_review', runId: 'review-1', leaseId: 'lease-1', state: 'committed' })
  })
})
