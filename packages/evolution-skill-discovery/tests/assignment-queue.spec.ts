// @tier ci-only
import { expect, it } from 'vitest'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { AssignmentWorker, DomainAssignmentService, DomainMapFileStore, JsonAssignmentQueue, type AssignmentProposal } from '../src/index.ts'

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

it('persists queued assignment across a new queue instance', async () => {
  const io = new Io()
  const first = new JsonAssignmentQueue(io, 'queue.json')
  const submission = { skillKey: 'k', threeFieldHash: 'h', modelInvocable: true }
  await first.enqueue({ key: 'k', submission, proposalDigest: 'p', createdAt: 1 })
  const second = new JsonAssignmentQueue(io, 'queue.json')
  await second.load()
  expect(second.list()).toHaveLength(1)
  await second.update('k', 'pending', 'map-version-stale')
  const third = new JsonAssignmentQueue(io, 'queue.json')
  await third.load()
  expect(third.list()[0]?.status).toBe('pending')
})


it('retries a queued assignment after a new queue instance loads it', async () => {
  const io = new Io()
  const proposal: AssignmentProposal = { mode: 'new', proposed: { title: 'Q Domain', purpose: 'purpose', inScope: ['in'], outOfScope: ['out'], triggers: ['t'], evidenceSkillKeys: ['k'] }, confidence: 1, reason: 'r', mapVersion: '0' }
  const submission = { skillKey: 'k', threeFieldHash: 'h', modelInvocable: true, whenToUse: 'when t', proposal }
  const first = new JsonAssignmentQueue(io, 'queue.json')
  await first.enqueue({ key: 'k', submission, proposalDigest: 'p', createdAt: 1 })
  const second = new JsonAssignmentQueue(io, 'queue.json')
  await second.load()
  const store = new DomainMapFileStore(io, 'map.json', () => 1)
  const service = new DomainAssignmentService(second, store, { createClassificationEnabled: true, now: () => 1 })
  expect(await new AssignmentWorker(service, second).drain()).toBe(1)
  expect(second.list()[0]?.status).not.toBe('queued')
})
