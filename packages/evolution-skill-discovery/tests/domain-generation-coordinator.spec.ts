// @tier ci-only
import { expect, it } from 'vitest'
import type { DomainMapSnapshot, DomainMapStore } from '../src/domain-map.ts'
import { DomainGenerationCoordinator } from '../src/domain-generation-coordinator.ts'
import type { DomainGenerationProposal } from '../src/domain-generation.ts'
import { bootstrapFactsFromRows } from '../src/generation-input.ts'
import { skillIndexRowOf } from '../src/identity.ts'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'

const names = Array.from({ length: 8 }, (_, index) => 'skill-' + index)
const proposal: DomainGenerationProposal = {
  domains: names.map((name, index) => ({
    title: 'domain-' + index,
    purpose: 'purpose ' + index,
    inScope: ['in'],
    outOfScope: ['out'],
    triggers: ['trigger'],
    evidenceSkillKeys: [name],
  })),
}
const request = {
  mapScope: 'global',
  sourceDigest: 'source-1',
  expectedMapVersion: '0',
  facts: names.map(name => ({ name, description: name + ' description', skillKey: name, threeFieldHash: 'hash-' + name })),
  prompt: 'prompt',
  promptVersion: 'v2',
  model: 'deepseek-flash',
  runId: 'run-1',
}

function fixture(): { store: DomainMapStore; calls: () => number } {
  let snapshot: DomainMapSnapshot = { mapVersion: '0', domains: [], edges: [] }
  let calls = 0
  const store = {
    read: async () => snapshot,
    commit: async (_expected: string, next: Omit<DomainMapSnapshot, 'mapVersion'> & { mapVersion: string }) => {
      snapshot = { mapVersion: next.mapVersion, domains: next.domains, edges: next.edges }
      return snapshot
    },
    rollback: async () => snapshot,
  } as DomainMapStore
  const port = { generate: async () => { calls += 1; return proposal } }
  return { store: Object.assign(store, { calls: () => calls }), calls: () => calls }
}

it('coalesces concurrent initial generation and stops when domains exist', async () => {
  const f = fixture()
  const coordinator = new DomainGenerationCoordinator(f.store, { generate: async () => { return proposal } })
  const first = await coordinator.ensure(request)
  const second = await coordinator.ensure(request)
  expect(first.domains).toHaveLength(8)
  expect(second.domains).toHaveLength(8)
  expect(second.mapVersion).toBe('1')
  expect(second.edges[0]?.skillHash).toBe('hash-skill-0')
  expect(second.domains[0]?.provenance).toMatchObject({ source: 'llm', promptVersion: 'v2', sourceDigest: 'source-1', model: 'deepseek-flash', runId: 'run-1' })
})

it('shares one in-flight generation across concurrent callers', async () => {
  const f = fixture()
  let calls = 0
  const coordinator = new DomainGenerationCoordinator(f.store, { generate: async () => { calls += 1; await Promise.resolve(); return proposal } })
  await Promise.all([coordinator.ensure(request), coordinator.ensure(request)])
  expect(calls).toBe(1)
})

it('derives generation facts from live rows, not config', () => {
  const summary: SkillSummary = { name: 'alpha', description: 'alpha desc', whenToUse: 'use alpha', invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider: 'dsh-evolution' }
  const facts = bootstrapFactsFromRows([skillIndexRowOf(summary, true)])
  expect(facts).toEqual([{ name: 'alpha', description: 'alpha desc', whenToUse: 'use alpha', skillKey: expect.any(String), threeFieldHash: expect.any(String) }])
})
