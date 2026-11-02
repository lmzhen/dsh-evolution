// @tier ci-only
import { describe, expect, it } from 'vitest'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import {
  DomainPolicyStore,
  ProjectionJournal,
  ViewStateRegistry,
  applyCapturedProjection,
  canProject,
  captureCatalog,
  deriveViewState,
  renderCatalog,
  restoreCapturedProjection,
  restoreCatalog,
  type CatalogCapture,
} from '../src/index.ts'

const entries = [{ name: 'alpha', description: 'a' }, { name: 'beta', description: 'b' }]
const text = [
  '<system-reminder>',
  'A skill is reusable.',
  '<available_skills>',
  '- `alpha`: a',
  '- `beta`: b',
  '</available_skills>',
  'Load all applicable skills before acting.',
  '</system-reminder>',
].join('\n')

function platformDecision(): PreStepDecision {
  return {
    kind: 'enter',
    messages: [createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'skill-catalog', form: 'catalog', entries },
    })],
  }
}

function capture(): CatalogCapture {
  const decision = platformDecision()
  if (decision.kind !== 'enter') throw new Error('expected enter')
  const captured = captureCatalog(decision.messages[0]!)
  if (captured === undefined) throw new Error('expected catalog')
  return captured
}

describe('ViewState', () => {
  const base = { viewKey: 'v1', mode: 'on' as const, mapVersion: 'm', policyDigest: 'p', viewCatalogDigest: 'c' }

  it('keeps per-view readiness and blocks hiding on search degradation', () => {
    const degraded = deriveViewState({ ...base, viewKey: 'v2', map: 'ready', search: 'degraded', policy: 'ready', catalogComplete: true })
    expect(canProject(degraded)).toBe(true)
  })

  it('does not let one view authorize another and bounds the registry', () => {
    const registry = new ViewStateRegistry({ limit: 2, now: () => 0 })
    const a = deriveViewState({ ...base, map: 'ready', search: 'ready', policy: 'ready', catalogComplete: true })
    const b = deriveViewState({ ...base, viewKey: 'v2', map: 'empty', search: 'ready', policy: 'ready', catalogComplete: true })
    registry.set(a, 'codec-1')
    registry.set(b, 'codec-1')
    expect(registry.get('v1', 'm', 'p', 'codec-1')?.phase).toBe('ready')
    expect(registry.get('v2', 'm', 'p', 'codec-1')?.phase).toBe('unavailable')
    registry.set(deriveViewState({ ...base, viewKey: 'v3', map: 'empty', search: 'ready', policy: 'ready', catalogComplete: true }), 'codec-1')
    expect(registry.get('v1', 'm', 'p', 'codec-1')).toBeUndefined()
  })
})

describe('DomainPolicyStore', () => {
  it('reports unknown ids as degraded and keeps revisions in the digest', () => {
    const store = new DomainPolicyStore({
      global: { mode: 'on', pinDomains: ['known', 'missing'], revision: 'g1' },
      knownDomainIds: new Set(['known']),
    })
    const policy = store.resolve()
    expect(policy.pinned.has('known')).toBe(true)
    expect(policy.degraded).toEqual(['missing'])
    expect(store.resolve(new Set(['known', 'missing'])).degraded).toEqual([])
    expect(store.digest()).not.toBe(new DomainPolicyStore({ global: { mode: 'on', revision: 'g2' }, knownDomainIds: new Set(['known']) }).digest())
  })
})

describe('CatalogCodec', () => {
  it('captures and rewrites only the available_skills block', () => {
    const base = capture()
    const projected = renderCatalog(base, [{ name: 'alpha', description: 'a' }])
    const body = projected.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(body).toContain('A skill is reusable.')
    expect(body).toContain('Load all applicable skills before acting.')
    expect(body).toContain('- `alpha`: a')
    expect(body).not.toContain('- `beta`: b')
    expect((projected.source as { entries: unknown }).entries).toEqual(entries)
    expect(restoreCatalog(base).content).toEqual([{ type: 'text', text }])
  })

  it('escapes projected descriptions and keeps platform formatting', () => {
    const base = capture()
    const projected = renderCatalog(base, [{ name: 'alpha', description: '<bad> & risky' }])
    const body = projected.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(body).toContain('- `alpha`: &lt;bad&gt; &amp; risky')
  })

  it('rejects unknown catalog text', () => {
    const message = createUserMessage({ content: [{ type: 'text', text: 'not a catalog' }], source: { kind: 'user' } })
    expect(captureCatalog(message)).toBeUndefined()
  })
})

describe('ProjectionJournal and adapter', () => {
  it('persists a base and restores the exact catalog', async () => {
    const files = new Map<string, string>()
    const io: EvolutionIoLike = {
      readText: async path => files.get(path) ?? null,
      writeText: async (path, content) => { files.set(path, content) },
      remove: async path => { files.delete(path) },
      list: async () => [],
      exists: async path => files.has(path),
      rename: async (path, destination) => { const value = files.get(path); if (value !== undefined) { files.delete(path); files.set(destination, value) } },
      copy: async (path, destination) => { const value = files.get(path); if (value !== undefined) files.set(destination, value) },
    }
    const journal = new ProjectionJournal(io, 'journal.json', { maxRecords: 2 })
    const base = capture()
    const record = { sessionId: 's', viewKey: 'v', projectionDigest: 'd', codecVersion: 'c1', mapVersion: 'm', policyDigest: 'p', base, createdAt: 1 }
    await journal.put(record)
    expect(await journal.get('s', 'v', 'd', 'c1')).toEqual(record)

    const decision = platformDecision()
    const applied = applyCapturedProjection(decision, base, [{ name: 'alpha', description: 'a' }])
    const restored = restoreCapturedProjection(applied, base)
    if (restored.kind !== 'enter') throw new Error('expected enter')
    expect(restored.messages[0]?.content).toEqual([{ type: 'text', text }])
    await journal.remove('s', 'v', 'd', 'c1')
    expect(await journal.get('s', 'v', 'd', 'c1')).toBeUndefined()
  })
})
