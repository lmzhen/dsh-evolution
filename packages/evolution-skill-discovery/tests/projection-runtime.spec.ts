// @tier ci-only
import { describe, expect, it } from 'vitest'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import {
  DomainPolicyStore,
  ProjectionJournal,
  ProjectionRuntime,
  skillIndexRowOf,
  skillKeyOf,
  type DomainMapSnapshot,
  type DomainMapStore,
  type DomainNode,
  type SkillDomainEdge,
} from '../src/index.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

function summary(name: string, provider = 'dsh-evolution'): SkillSummary {
  return { name, description: name + ' description', whenToUse: undefined, invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider }
}
function node(id: string): DomainNode {
  return { id, name: id, purpose: 'purpose ' + id, description: 'old', inScope: ['in'], outOfScope: ['out'], triggers: ['t'], parentIds: [], status: 'active', version: 1, createdAt: 0, updatedAt: 0, descriptionHash: 'h', descriptionVersion: 1, descriptionStatus: 'fresh', provenance: {}, quality: {} }
}
function edge(key: string): SkillDomainEdge {
  return { skillKey: key, domainId: 'd1', role: 'primary', confidence: 1, source: 'manual', skillHash: 'h', mapVersion: '1', status: 'active', assignedAt: 0 }
}
const alpha = summary('alpha')
const beta = summary('beta', 'other')
const snapshot: DomainMapSnapshot = { mapVersion: '1', domains: [node('d1')], edges: [{ ...edge(skillKeyOf(alpha)), skillHash: skillIndexRowOf(alpha, true).threeFieldHash }] }
const source = {
  snapshot: async () => ({ skills: [alpha, beta], complete: true }),
  managedSkillKeys: async () => new Set([skillKeyOf(alpha)]),
  protectedSkillKeys: async () => new Set<string>(),
  pinnedSkillKeys: async () => new Set<string>(),
}
const text = ['<system-reminder>', 'REUSABLE', '<available_skills>', '- alpha: alpha description', '- beta: beta description', '</available_skills>', 'FOOTER', '</system-reminder>'].join('\n')
function decision(): PreStepDecision {
  return { kind: 'enter', messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'alpha', description: 'alpha description' }, { name: 'beta', description: 'beta description' }] } })] }
}
function memoryIo(): EvolutionIoLike {
  const files = new Map<string, string>()
  return {
    readText: async path => files.get(path) ?? null,
    writeText: async (path, content) => { files.set(path, content) },
    remove: async path => { files.delete(path) },
    list: async () => [],
    exists: async path => files.has(path),
    rename: async (path, destination) => { const value = files.get(path); if (value !== undefined) { files.delete(path); files.set(destination, value) } },
    copy: async (path, destination) => { const value = files.get(path); if (value !== undefined) files.set(destination, value) },
  }
}
function agent(id = 'a1'): Agent { return { id, session: { id: 's1' } } as Agent }
function runtime(map: DomainMapStore, journal: ProjectionJournal, frozen = false): ProjectionRuntime {
  return new ProjectionRuntime({
    skillIndexSource: source,
    map,
    policy: new DomainPolicyStore({ global: { mode: 'on' } }),
    journal,
    workingDirectory: { ensure: async () => '/w' },
    featureEpoch: 'e', codecVersion: 'c1', adapterVersion: 'a', projectionSchemaVersion: 'p', mode: 'on',
    isFrozen: () => frozen,
  })
}
function catalogText(out: PreStepDecision): string {
  if (out.kind !== 'enter') return ''
  return out.messages.map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('')).join('')
}

describe('ProjectionRuntime', () => {
  it('applies per-view projection and restores after map becomes corrupt', async () => {
    let broken = false
    const map = { read: async () => { if (broken) throw new Error('map broken'); return snapshot } } as DomainMapStore
    const journal = new ProjectionJournal(memoryIo(), 'journal.json')
    const rt = runtime(map, journal)
    const applied = await rt.project(agent(), decision())
    expect(catalogText(applied)).toContain('- `beta`:')
    expect(catalogText(applied)).not.toContain('- alpha:')
    expect(catalogText(applied)).toContain('<skill_domains>')
    expect(catalogText(applied)).toContain('d1')
    expect(rt.report().action).toBe('applied')
    broken = true
    const restored = await rt.project(agent(), applied)
    expect(rt.report().action).toBe('restored')
    expect(catalogText(restored)).toContain('- alpha:')
    expect(catalogText(restored)).toContain('FOOTER')
    expect(catalogText(restored)).not.toContain('<skill_domains>')
  })

  it('stops hiding when search becomes unavailable', async () => {
    let searchReady = true
    const map = { read: async () => snapshot } as DomainMapStore
    const rt = new ProjectionRuntime({
      skillIndexSource: source, map, policy: new DomainPolicyStore({ global: { mode: 'on' } }), journal: new ProjectionJournal(memoryIo(), 'journal.json'), workingDirectory: { ensure: async () => '/w' },
      featureEpoch: 'e', codecVersion: 'c1', adapterVersion: 'a', projectionSchemaVersion: 'p', mode: 'on', searchAvailable: () => searchReady,
    })
    const applied = await rt.project(agent(), decision())
    expect(catalogText(applied)).not.toContain('- alpha:')
    searchReady = false
    const restored = await rt.project(agent(), applied)
    expect(catalogText(restored)).toContain('- `alpha`:')
  })

  it('restores with a replacement catalog when no catalog is present', async () => {
    let broken = false
    const map = { read: async () => { if (broken) throw new Error('map broken'); return snapshot } } as DomainMapStore
    const rt = runtime(map, new ProjectionJournal(memoryIo(), 'journal.json'))
    await rt.project(agent(), decision())
    broken = true
    const restored = await rt.project(agent(), { kind: 'enter', messages: [] })
    const text = restored.kind === 'enter' ? restored.messages.map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('')).join('\n') : ''
    expect(text).toContain('- `alpha`:')
    expect(text).toContain('replacement catalog')
  })

  it('appends a replacement catalog when the map changes without a catalog message', async () => {
    let current: DomainMapSnapshot = snapshot
    const map = { read: async () => current } as DomainMapStore
    const rt = runtime(map, new ProjectionJournal(memoryIo(), 'journal.json'))
    await rt.project(agent(), decision())
    current = { ...snapshot, mapVersion: '2', edges: [] }
    const changed = await rt.project(agent(), { kind: 'enter', messages: [] })
    const text = changed.kind === 'enter' ? changed.messages.map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('')).join('\n') : ''
    expect(text).toContain('- `alpha`:')
    expect(text).toContain('replacement catalog')
  })

  it('reprojects a full catalog after compaction instead of returning the unprojected decision', async () => {
    const map = { read: async () => snapshot } as DomainMapStore
    const rt = runtime(map, new ProjectionJournal(memoryIo(), 'journal.json'))
    await rt.project(agent(), decision())
    const reemitted = await rt.project(agent(), decision())
    expect(catalogText(reemitted)).not.toContain('- alpha:')
    expect(catalogText(reemitted)).toContain('- `beta`:')
  })

  it('restores from session history after a process restart', async () => {
    const base = decision()
    const message = base.kind === 'enter' ? base.messages[0]! : undefined
    const session = { readEvents: () => message === undefined ? [] : [{ type: 'user/message', data: message }] }
    const first = { id: 'restart', session } as unknown as Agent
    const journal = new ProjectionJournal(memoryIo(), 'journal.json')
    const map = { read: async () => snapshot } as DomainMapStore
    const applied = await runtime(map, journal).project(first, decision())
    const restarted = new ProjectionRuntime({ skillIndexSource: source, map: { read: async () => { throw new Error('broken') } } as DomainMapStore, policy: new DomainPolicyStore({ global: { mode: 'on' } }), journal, workingDirectory: { ensure: async () => '/w' }, featureEpoch: 'e', codecVersion: 'c1', adapterVersion: 'a', projectionSchemaVersion: 'p', mode: 'on' })
    const restored = await restarted.project(first, applied)
    expect(catalogText(restored)).toContain('- alpha:')
  })

  it('recovers the catalog from session history when no current capture or journal exists', async () => {
    const base = decision()
    const message = base.kind === 'enter' ? base.messages[0]! : undefined
    const cold = { id: 'cold', session: { readEvents: () => message === undefined ? [] : [{ type: 'user/message', data: message }] } } as unknown as Agent
    const map = { read: async () => snapshot } as DomainMapStore
    const rt = runtime(map, new ProjectionJournal(memoryIo(), 'journal.json'))
    const projected = await rt.project(cold, { kind: 'enter', messages: [] })
    expect(catalogText(projected)).toContain('replacement catalog')
  })

  it('passes now so production can mark aged descriptions stale', async () => {
    const map = { read: async () => snapshot } as DomainMapStore
    const rt = new ProjectionRuntime({ skillIndexSource: source, map, policy: new DomainPolicyStore({ global: { mode: 'on' } }), journal: new ProjectionJournal(memoryIo(), 'journal.json'), workingDirectory: { ensure: async () => '/w' }, featureEpoch: 'e', codecVersion: 'c1', adapterVersion: 'a', projectionSchemaVersion: 'p', mode: 'on', descriptionStaleAfterHours: 1 })
    const applied = await rt.project(agent(), decision())
    expect(catalogText(applied)).toContain('descriptionStatus=stale')
  })

  it('does not append the same projection digest twice', async () => {
    const map = { read: async () => snapshot } as DomainMapStore
    const rt = new ProjectionRuntime({ skillIndexSource: source, map, policy: new DomainPolicyStore({ global: { mode: 'on' } }), journal: new ProjectionJournal(memoryIo(), 'journal.json'), workingDirectory: { ensure: async () => '/w' }, featureEpoch: 'e', codecVersion: 'c1', adapterVersion: 'a', projectionSchemaVersion: 'p', mode: 'on' })
    const applied = await rt.project(agent(), decision())
    const second = await rt.project(agent(), applied)
    expect(second).toBe(applied)
  })

  it('does not project a frozen session', async () => {
    const map = { read: async () => snapshot } as DomainMapStore
    const rt = runtime(map, new ProjectionJournal(memoryIo(), 'journal.json'), true)
    const original = decision()
    expect(await rt.project(agent(), original)).toBe(original)
  })
})
