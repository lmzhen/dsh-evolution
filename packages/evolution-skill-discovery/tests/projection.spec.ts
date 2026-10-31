import { describe, expect, it } from 'vitest'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { projectCatalog, skillIndexRowOf, skillKeyOf, type CatalogEntry, type DomainCard } from '../src/index.ts'

function summary(name: string, provider = 'dsh-evolution', modelInvocable = true): SkillSummary {
  return {
    name,
    description: name + ' description',
    whenToUse: 'when ' + name,
    invocation: { modelInvocable, userInvocable: true },
    source: 'user-dsh',
    provider,
  }
}

const card: DomainCard = {
  id: 'domain-a',
  title: 'Domain A',
  purpose: 'covers alpha',
  triggers: ['alpha'],
  descriptionStatus: 'fresh',
  managedModelInvocableCount: 1,
  externalCatalogCount: 1,
  managedCount: 1,
  externalCount: 1,
  pendingCount: 0,
  state: 'active',
  asOf: '2026-10-30T00:00:00Z',
  mapVersion: 'm1',
  mapStale: false,
}

function input(entries: CatalogEntry[], complete = true) {
  return {
    entries,
    rows: [
      skillIndexRowOf(summary('alpha'), true),
      skillIndexRowOf(summary('beta', 'other'), false),
      skillIndexRowOf(summary('gamma'), true),
    ],
    activeManagedSkillKeys: new Set([skillKeyOf(summary('alpha'))]),
    cards: [card],
    viewKey: 'view',
    scope: 'agent',
    mapVersion: 'm1',
    policyDigest: 'p1',
    viewCatalogDigest: 'c1',
    adapterVersion: 'a1',
    projectionSchemaVersion: 's1',
    discoveryMode: 'on',
    complete,
  }
}

describe('projectCatalog', () => {
  it('hides only active managed; keeps external and unclassified/provisional', () => {
    const entries = [
      { name: 'alpha', description: 'a' },
      { name: 'beta', description: 'b' },
      { name: 'gamma', description: 'g' },
    ]
    const result = projectCatalog(input(entries))
    expect(result.hiddenNames).toEqual(['alpha'])
    expect(result.catalogEntries.map(entry => entry.name)).toEqual(['beta', 'gamma'])
    expect(result.context).toContain('Domain A')
    expect(result.context).not.toContain('beta')
    expect(result.context).not.toContain('<available_skills>')
  })

  it('fails open on incomplete input', () => {
    const entries = [{ name: 'alpha', description: 'a' }]
    const result = projectCatalog(input(entries, false))
    expect(result.complete).toBe(false)
    expect(result.hiddenNames).toEqual([])
    expect(result.catalogEntries).toEqual(entries)
    expect(result.context).toBe('')
  })

  it('is deterministic and changes digest with identity', () => {
    const a = projectCatalog(input([{ name: 'alpha', description: 'a' }]))
    const b = projectCatalog(input([{ name: 'alpha', description: 'a' }]))
    expect(a).toEqual(b)
    const c = projectCatalog({ ...input([{ name: 'alpha', description: 'a' }]), mapVersion: 'm2' })
    expect(a.digest).not.toBe(c.digest)
  })
})
