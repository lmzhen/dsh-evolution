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

  it('applies one projection context when a full catalog is re-sent (compaction)', async () => {
    const map = { read: async () => snapshot } as DomainMapStore
    const rt = runtime(map, new ProjectionJournal(memoryIo(), 'journal.json'))
    const first = await rt.project(agent(), decision())
    const second = await rt.project(agent(), decision())
    const firstContexts = first.kind === 'enter' ? first.messages.filter(message => message.source.kind === 'evolution-skill-projection') : []
    const secondContexts = second.kind === 'enter' ? second.messages.filter(message => message.source.kind === 'evolution-skill-projection') : []
    expect(firstContexts).toHaveLength(1)
    expect(secondContexts).toHaveLength(0)
    expect(catalogText(first)).toContain('- `beta`:')
    expect(catalogText(second)).toContain('- `beta`:')
  })

  it('restores from the newest journal base instead of the first full catalog in session history', async () => {
    const gamma = summary('gamma')
    const allSource = { ...source, snapshot: async () => ({ skills: [alpha, beta, gamma], complete: true }) }
    const allSnapshot = { ...snapshot, edges: [{ ...edge(skillKeyOf(alpha)), skillHash: skillIndexRowOf(alpha, true).threeFieldHash }] }
    const body = (names: readonly string[]) => ['<system-reminder>', 'REUSABLE', '<available_skills>', ...names.map(name => '- ' + name + ': ' + name + ' description'), '</available_skills>', 'FOOTER', '</system-reminder>'].join('\n')
    const catalog = (names: readonly string[]): PreStepDecision => ({ kind: 'enter', messages: [createUserMessage({ content: [{ type: 'text', text: body(names) }], source: { kind: 'skill-catalog', form: 'catalog', entries: names.map(name => ({ name, description: name + ' description' })) } })] })
    const t1 = catalog(['alpha', 'beta'])
    const t2 = catalog(['alpha', 'beta', 'gamma'])
    const events = [t1, t2].flatMap(item => item.kind === 'enter' ? item.messages.map(message => ({ type: 'user/message', data: message })) : [])
    const sessionAgent = { id: 'newest-base', session: { id: 's', readEvents: () => events } } as unknown as Agent
    const journal = new ProjectionJournal(memoryIo(), 'journal.json')
    const map = { read: async () => allSnapshot } as DomainMapStore
    const rt = new ProjectionRuntime({ skillIndexSource: allSource, map, policy: new DomainPolicyStore({ global: { mode: 'on' } }), journal, workingDirectory: { ensure: async () => '/w' }, featureEpoch: 'e', codecVersion: 'c1', adapterVersion: 'a', projectionSchemaVersion: 'p', mode: 'on' })
    const applied = await rt.project(sessionAgent, t2)
    expect(catalogText(applied)).not.toContain('- `alpha`:')
    const restarted = new ProjectionRuntime({ skillIndexSource: allSource, map: { read: async () => { throw new Error('broken') } } as DomainMapStore, policy: new DomainPolicyStore({ global: { mode: 'on' } }), journal, workingDirectory: { ensure: async () => '/w' }, featureEpoch: 'e', codecVersion: 'c1', adapterVersion: 'a', projectionSchemaVersion: 'p', mode: 'on' })
    const restored = await restarted.project(sessionAgent, applied)
    expect(catalogText(restored)).toContain('- gamma:')
    expect(catalogText(restored)).toContain('- alpha:')
  })

  it('restores a projected-only cold session from its full source entries instead of blocking', async () => {
    const map = { read: async () => snapshot } as DomainMapStore
    const journal = new ProjectionJournal(memoryIo(), 'journal.json')
    const cold = { id: 'cold-projected', session: { id: 's' } } as unknown as Agent
    const applied = await runtime(map, journal).project(cold, decision())
    const restarted = new ProjectionRuntime({ skillIndexSource: source, map: { read: async () => { throw new Error('broken') } } as DomainMapStore, policy: new DomainPolicyStore({ global: { mode: 'on' } }), journal: new ProjectionJournal(memoryIo(), 'empty.json'), workingDirectory: { ensure: async () => '/w' }, featureEpoch: 'e', codecVersion: 'c1', adapterVersion: 'a', projectionSchemaVersion: 'p', mode: 'on' })
    const restored = await restarted.project(cold, applied)
    expect(restarted.report().action).toBe('restored')
    expect(catalogText(restored)).toContain('- `alpha`:')
  })

  it('does not re-append a replacement catalog on a restarted runtime with the same session digest', async () => {
    const map = { read: async () => snapshot } as DomainMapStore
    const journal = new ProjectionJournal(memoryIo(), 'journal.json')
    const sessionAgent = { id: 'restart-replay', session: { id: 's', readEvents: () => [] } } as unknown as Agent
    const first = await runtime(map, journal).project(sessionAgent, decision())
    const message = first.kind === 'enter' ? first.messages.find(item => item.source.kind === 'evolution-skill-projection') : undefined
    expect(message).toBeDefined()
    const session = { id: 's', readEvents: () => message === undefined ? [] : [{ type: 'user/message', data: message }] }
    const replayAgent = { id: 'restart-replay', session } as unknown as Agent
    const restarted = runtime(map, journal)
    const replay = await restarted.project(replayAgent, { kind: 'enter', messages: [] })
    expect(catalogText(replay)).toBe('')
    expect(restarted.report().action).toBe('none')
  })


  it('adds domain cards even when no skill is hidden', async () => {
    const cardsOnly = { ...snapshot, edges: [] } as DomainMapSnapshot
    const map = { read: async () => cardsOnly } as DomainMapStore
    const rt = runtime(map, new ProjectionJournal(memoryIo(), 'journal.json'))
    const applied = await rt.project(agent(), decision())
    const contexts = applied.kind === 'enter' ? applied.messages.filter(message => message.source.kind === 'evolution-skill-projection') : []
    expect(contexts).toHaveLength(1)
    expect(catalogText(applied)).toContain('<skill_domains>')
    expect(rt.report().action).toBe('applied')
  })


  it('resolves policy per working directory for two windows', async () => {
    const map = { read: async () => snapshot } as DomainMapStore
    const disabled = new DomainPolicyStore({ global: { mode: 'on' }, workspace: { disableDomains: ['d1'] } })
    const enabled = new DomainPolicyStore({ global: { mode: 'on' } })
    const rt = new ProjectionRuntime({
      skillIndexSource: source, map, policy: enabled, policyFor: async cwd => cwd === '/a' ? disabled : enabled,
      journal: new ProjectionJournal(memoryIo(), 'journal.json'),
      workingDirectory: { ensure: async agent => agent.id === 'a' ? '/a' : '/b' },
      featureEpoch: 'e', codecVersion: 'c1', adapterVersion: 'a', projectionSchemaVersion: 'p', mode: 'on',
    })
    const aAgent = { id: 'a', session: { id: 'sa' } } as unknown as Agent
    const bAgent = { id: 'b', session: { id: 'sb' } } as unknown as Agent
    const a = await rt.project(aAgent, decision())
    const b = await rt.project(bAgent, decision())
    expect(catalogText(a)).toContain('- `alpha`:')
    expect(catalogText(b)).not.toContain('- `alpha`:')
  })

})
