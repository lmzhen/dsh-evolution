import { describe, expect, it } from 'vitest'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import {
  DomainAssignmentService,
  DomainMapFileStore,
  AssignmentWorker,
  MemoryAssignmentQueue,
  assignmentKey,
  coveredByDomain,
  proposalDigest,
  type AssignmentProposal,
  type DomainNode,
  type DomainMapSnapshot,
} from '../src/index.ts'

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
function proposal(): AssignmentProposal {
  return { mode: 'new', proposed: { title: 'New Domain', purpose: 'distinct purpose', inScope: ['alpha'], outOfScope: ['beta'], triggers: ['trigger'], evidenceSkillKeys: ['alpha'] }, confidence: 1, reason: 'coverage', needsReview: false, mapVersion: '0' }
}
function service(threshold = 1, enabled = true) {
  const store = new DomainMapFileStore(new MemoryIo(), 'map.json', () => 1)
  return new DomainAssignmentService(new MemoryAssignmentQueue(), store, { createClassificationEnabled: enabled, provisionalThreshold: threshold, now: () => 1 })
}

describe('assignment contract', () => {
  it('returns unclassified for feature-off, no proposal, or non-model-invocable', async () => {
    const off = service(1, false)
    expect((await off.submit({ skillKey: 'k', threeFieldHash: 'h', modelInvocable: true, proposal: proposal() })).kind).toBe('unclassified')
    const on = service()
    expect((await on.submit({ skillKey: 'k', threeFieldHash: 'h', modelInvocable: true })).kind).toBe('unclassified')
    expect((await on.submit({ skillKey: 'k', threeFieldHash: 'h', modelInvocable: false, proposal: proposal() })).kind).toBe('unclassified')
  })

  it('queues idempotently and applies a new domain as active at threshold 1', async () => {
    const svc = service(1)
    const first = await svc.submit({ skillKey: 'k', threeFieldHash: 'h', modelInvocable: true, whenToUse: 'when trigger coverage', proposal: proposal() })
    expect(first.kind).toBe('queued')
    if (first.kind !== 'queued') return
    const second = await svc.submit({ skillKey: 'k', threeFieldHash: 'h', modelInvocable: true, whenToUse: 'when trigger coverage', proposal: proposal() })
    expect(second.kind).toBe('queued')
    if (second.kind !== 'queued') return
    expect(second.duplicate).toBe(true)
    const applied = await svc.process(first.entry)
    expect(applied.kind).toBe('applied')
    if (applied.kind !== 'applied') return
  })

  it('keeps a new domain provisional below threshold and unknown existing pending', async () => {
    const provisional = service(3)
    const submitted = await provisional.submit({ skillKey: 'k', threeFieldHash: 'h', modelInvocable: true, whenToUse: 'when trigger', proposal: proposal() })
    if (submitted.kind !== 'queued') throw new Error('not queued')
    expect((await provisional.process(submitted.entry)).kind).toBe('provisional')
    const existing = service(1)
    const result = await existing.submit({ skillKey: 'k2', threeFieldHash: 'h2', modelInvocable: true, whenToUse: 'when trigger', proposal: { ...proposal(), mode: 'existing', id: 'missing' } })
    if (result.kind !== 'queued') throw new Error('not queued')
    const pending = await existing.process(result.entry)
    expect(pending.kind).toBe('pending')
    if (pending.kind === 'pending') expect(pending.reason).toBe('unknown-domain')
  })

  it('covers ASSIGN-012 semantic fixtures without reading body', () => {
    const domain = { inScope: ['deploy'], outOfScope: ['delete'], triggers: ['release'] }
    expect(coveredByDomain('release a build', domain)).toBe(true)
    expect(coveredByDomain('deploy service', domain)).toBe(true)
    expect(coveredByDomain('delete a record', domain)).toBe(false)
    expect(coveredByDomain('release delete', domain)).toBe(false)
    expect(coveredByDomain('', domain)).toBe(false)
    expect(coveredByDomain('unrelated task', domain)).toBe(false)
  })

  it('stages create without queueing and enqueues only after approval', async () => {
    const queue = new MemoryAssignmentQueue()
    const store = new DomainMapFileStore(new MemoryIo(), 'map.json', () => 1)
    const svc = new DomainAssignmentService(queue, store, { createClassificationEnabled: true, now: () => 1 })
    const staged = svc.stage({ skillKey: 'k4', threeFieldHash: 'h4', modelInvocable: true, whenToUse: 'when trigger', proposal: proposal() })
    expect(queue.list()).toHaveLength(0)
    expect((await svc.approve(staged)).kind).toBe('queued')
    expect(queue.list()).toHaveLength(1)
  })

  it('manually confirms a provisional domain without reclassification', async () => {
    const store = new DomainMapFileStore(new MemoryIo(), 'map.json', () => 1)
    const svc = new DomainAssignmentService(new MemoryAssignmentQueue(), store, { createClassificationEnabled: true, provisionalThreshold: 3, now: () => 1 })
    const submitted = await svc.submit({ skillKey: 'kc', threeFieldHash: 'hc', modelInvocable: true, whenToUse: 'when trigger', proposal: proposal() })
    if (submitted.kind !== 'queued') throw new Error('not queued')
    expect((await svc.process(submitted.entry)).kind).toBe('provisional')
    const domain = (await store.read()).domains.find(node => node.name === 'New Domain')
    expect(domain?.status).toBe('provisional')
    expect(await svc.confirm(domain?.id ?? 'missing')).toBe(true)
    expect((await store.read()).domains.find(node => node.id === domain?.id)?.status).toBe('active')
  })

  it('requires a proposal when create cards exist and reports queue-unavailable', async () => {
    const store = new DomainMapFileStore(new MemoryIo(), 'map.json', () => 1)
    const svc = new DomainAssignmentService(new MemoryAssignmentQueue(), store, { createClassificationEnabled: true, createCardsAvailable: true, now: () => 1 })
    const missing = await svc.submit({ skillKey: 'k5', threeFieldHash: 'h5', modelInvocable: true })
    expect(missing.kind).toBe('pending')
    if (missing.kind === 'pending') expect(missing.reason).toBe('schema-invalid')
    const failing = new DomainAssignmentService({ enqueue: async () => { throw new Error('down') }, update: async () => {} }, store, { createClassificationEnabled: true, now: () => 1 })
    const unavailable = await failing.submit({ skillKey: 'k6', threeFieldHash: 'h6', modelInvocable: true, proposal: proposal() })
    expect(unavailable.kind).toBe('pending')
    if (unavailable.kind === 'pending') expect(unavailable.reason).toBe('queue-unavailable')
  })

  it('promotes a provisional domain after three distinct skills', async () => {
    const store = new DomainMapFileStore(new MemoryIo(), 'map.json', () => 1)
    const svc = new DomainAssignmentService(new MemoryAssignmentQueue(), store, { createClassificationEnabled: true, provisionalThreshold: 3, now: () => 1 })
    for (let index = 0; index < 3; index += 1) {
      const submission = await svc.submit({ skillKey: 'k' + index, threeFieldHash: 'h' + index, modelInvocable: true, whenToUse: 'when trigger', proposal: { ...proposal(), mapVersion: (await store.read()).mapVersion } })
      if (submission.kind !== 'queued') throw new Error('not queued')
      await svc.process(submission.entry)
    }
    const domain = (await store.read()).domains.find(node => node.name === 'New Domain')
    expect(domain?.status).toBe('active')
  })

  it('drains queued assignments through the worker', async () => {
    const queue = new MemoryAssignmentQueue()
    const store = new DomainMapFileStore(new MemoryIo(), 'map.json', () => 1)
    const svc = new DomainAssignmentService(queue, store, { createClassificationEnabled: true, now: () => 1 })
    const submitted = await svc.submit({ skillKey: 'kw', threeFieldHash: 'hw', modelInvocable: true, whenToUse: 'when trigger', proposal: proposal() })
    if (submitted.kind !== 'queued') throw new Error('not queued')
    expect(await new AssignmentWorker(svc, queue).drain()).toBe(1)
    expect(queue.list()[0]?.status).not.toBe('queued')
  })

  it('rejects name-only coverage and computes stable keys/digests', () => {
    const domain: Pick<DomainNode, 'inScope' | 'outOfScope' | 'triggers'> = { inScope: ['alpha'], outOfScope: ['beta'], triggers: ['trigger'] }
    expect(coveredByDomain('when trigger', domain)).toBe(true)
    expect(coveredByDomain('when alpha', domain)).toBe(true)
    expect(coveredByDomain('when beta', domain)).toBe(false)
    expect(coveredByDomain('alpha', { ...domain, inScope: [], triggers: [] })).toBe(false)
    expect(assignmentKey({ skillKey: 'k', threeFieldHash: 'h', proposalDigest: proposalDigest(proposal()), mapVersion: '0' })).toHaveLength(64)
  })
})

function node(id: string, triggers: string[] = ['other']): DomainNode {
  return { id, name: id, purpose: 'distinct purpose', description: 'd', inScope: ['alpha'], outOfScope: ['beta'], triggers, parentIds: [], status: 'active', version: 1, createdAt: 0, updatedAt: 0, descriptionHash: 'h', descriptionVersion: 1, descriptionStatus: 'fresh', provenance: {}, quality: {} }
}

it('turns stale mapVersion and duplicate new-domain triggers into pending', async () => {
  const io = new MemoryIo(); const store = new DomainMapFileStore(io, 'map.json', () => 1); const queue = new MemoryAssignmentQueue()
  const svc = new DomainAssignmentService(queue, store, { createClassificationEnabled: true, now: () => 1 })
  const submitted = await svc.submit({ skillKey: 'k', threeFieldHash: 'h', modelInvocable: true, whenToUse: 'when trigger', proposal: proposal() })
  if (submitted.kind !== 'queued') throw new Error('not queued')
  await store.commit('0', { mapVersion: '1', domains: [], edges: [] })
  const stale = await svc.process(submitted.entry)
  expect(stale.kind).toBe('pending')
  if (stale.kind === 'pending') expect(stale.reason).toBe('map-version-stale')
  const io2 = new MemoryIo(); const store2 = new DomainMapFileStore(io2, 'map2.json', () => 1); const queue2 = new MemoryAssignmentQueue()
  const svc2 = new DomainAssignmentService(queue2, store2, { createClassificationEnabled: true, now: () => 1 })
  await store2.commit('0', { mapVersion: '1', domains: [node('old', ['trigger'])], edges: [] })
  const duplicate = await svc2.submit({ skillKey: 'k2', threeFieldHash: 'h2', modelInvocable: true, whenToUse: 'when trigger', proposal: { ...proposal(), mapVersion: '1' } })
  if (duplicate.kind !== 'queued') throw new Error('not queued2')
  const conflict = await svc2.process(duplicate.entry)
  expect(conflict.kind).toBe('pending')
  if (conflict.kind === 'pending') expect(conflict.reason).toBe('new-domain-conflict')
})

it('adds secondary edges without a second primary and keeps one primary rule', async () => {
  const io = new MemoryIo(); const store = new DomainMapFileStore(io, 'map.json', () => 1); const queue = new MemoryAssignmentQueue()
  const svc = new DomainAssignmentService(queue, store, { createClassificationEnabled: true, now: () => 1 })
  await store.commit('0', { mapVersion: '1', domains: [node('d1', ['trigger']), node('d2')], edges: [] })
  const submitted = await svc.submit({ skillKey: 'k3', threeFieldHash: 'h3', modelInvocable: true, whenToUse: 'when trigger', proposal: { ...proposal(), mode: 'existing', id: 'd1', mapVersion: '1', secondaryDomainIds: ['d2'] } })
  if (submitted.kind !== 'queued') throw new Error('not queued3')
  expect((await svc.process(submitted.entry)).kind).toBe('applied')
  const map = await store.read()
  expect(map.edges.filter(edge => edge.skillKey === 'k3').map(edge => edge.role).sort()).toEqual(['primary', 'secondary'])
})
