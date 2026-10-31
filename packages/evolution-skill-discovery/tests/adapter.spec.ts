import { describe, expect, it } from 'vitest'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { applyCatalogProjection, projectCatalog, type DomainCard } from '../src/index.ts'
import { skillIndexRowOf, skillKeyOf } from '../src/identity.ts'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'

function summary(name: string, provider = 'dsh-evolution', modelInvocable = true): SkillSummary {
  return { name, description: name + ' description', whenToUse: undefined, invocation: { modelInvocable, userInvocable: true }, source: 'user-dsh', provider }
}
const card: DomainCard = { id: 'd', title: 'Domain', purpose: 'p', triggers: [], descriptionStatus: 'fresh', managedModelInvocableCount: 1, externalCatalogCount: 0, managedCount: 1, externalCount: 0, pendingCount: 0, state: 'active', asOf: 'now', mapVersion: 'm1', mapStale: false }
function projection(complete = true) {
  return projectCatalog({
    entries: [{ name: 'alpha', description: 'a' }, { name: 'beta', description: 'b' }],
    rows: [skillIndexRowOf(summary('alpha'), true), skillIndexRowOf(summary('beta', 'other'), false)],
    activeManagedSkillKeys: new Set([skillKeyOf(summary('alpha'))]),
    cards: [card],
    viewKey: 'v', scope: 's', mapVersion: 'm', policyDigest: 'p', viewCatalogDigest: 'c',
    adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on', complete,
  })
}
function decision(): PreStepDecision {
  return {
    kind: 'enter',
    messages: [createUserMessage({
      content: [{ type: 'text', text: '<available_skills>- alpha</available_skills>' }],
      source: { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'alpha', description: 'a' }, { name: 'beta', description: 'b' }] },
    })],
  }
}

describe('applyCatalogProjection', () => {
  it('atomically replaces the platform catalog with the plugin-owned projection', () => {
    const out = applyCatalogProjection(decision(), projection())
    expect(out.kind).toBe('enter')
    if (out.kind !== 'enter') return
    expect(out.messages).toHaveLength(1)
    expect(out.messages[0]?.source.kind).toBe('evolution-skill-projection')
    const text = JSON.stringify(out.messages[0]?.content)
    expect(text).toContain('beta')
    expect(text).not.toContain('alpha description')
    expect(text).toContain('Domain')
  })

  it('returns the original decision on incomplete projection', () => {
    const original = decision()
    expect(applyCatalogProjection(original, projection(false))).toBe(original)
  })
})


it('preserves prefetch and every non-catalog contribution', () => {
  const prefetch = createUserMessage({ content: [{ type: 'text', text: 'PREFETCH' }], source: { kind: 'user' } })
  const original = decision()
  if (original.kind !== 'enter') throw new Error('expected enter')
  const out = applyCatalogProjection({ ...original, messages: [prefetch, ...original.messages] }, projection())
  if (out.kind !== 'enter') throw new Error('expected enter')
  expect(out.messages[0]).toBe(prefetch)
  expect(out.messages.some(message => message.source.kind === 'evolution-skill-projection')).toBe(true)
})
