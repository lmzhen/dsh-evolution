// @tier ci-only
import { describe, expect, it } from 'vitest'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import {
  SkillIndex,
  catalogRevisionOf,
  policyDigestOf,
  projectionDigestOf,
  searchIndexKeyOf,
  skillKeyOf,
  skillIndexRowOf,
  threeFieldHashOf,
  viewCatalogDigestOf,
  viewKeyOf,
} from '../src/index.ts'

function summary(name: string, provider = 'dsh-evolution', source = 'user-dsh', modelInvocable = true): SkillSummary {
  return {
    name,
    description: name + ' description',
    whenToUse: 'when ' + name,
    invocation: { modelInvocable, userInvocable: true },
    source,
    provider,
  }
}

describe('identity', () => {
  it('distinguishes the same name across provider/source', () => {
    const a = summary('alpha', 'dsh-evolution', 'user-dsh')
    const b = summary('alpha', 'other', 'user-dsh')
    expect(skillKeyOf(a)).not.toBe(skillKeyOf(b))
  })

  it('has stable view keys and is sensitive to cwd/scope', () => {
    expect(viewKeyOf({ cwd: 'D:/work', scopeKey: 's1' })).toBe(viewKeyOf({ cwd: 'D:/work', scopeKey: 's1' }))
    expect(viewKeyOf({ cwd: 'D:/work', scopeKey: 's1' })).not.toBe(viewKeyOf({ cwd: 'D:/other', scopeKey: 's1' }))
    expect(viewKeyOf({ cwd: 'D:/work', scopeKey: 's1' })).not.toBe(viewKeyOf({ cwd: 'D:/work', scopeKey: 's2' }))
  })

  it('hashes the three routing fields', () => {
    expect(threeFieldHashOf(summary('alpha'))).toBe(threeFieldHashOf(summary('alpha')))
    expect(threeFieldHashOf(summary('alpha'))).not.toBe(threeFieldHashOf(summary('beta')))
  })

  it('composes view/policy/projection/search digests deterministically', () => {
    const row = skillIndexRowOf(summary('alpha'), true)
    const catalog = catalogRevisionOf([row], true)
    const view = viewCatalogDigestOf('v', [row], true)
    const policy = policyDigestOf({ globalPolicyRevision: '1', effectivePolicy: { mode: 'auto' } })
    expect(view).toBe(viewCatalogDigestOf('v', [row], true))
    expect(projectionDigestOf({ viewKey: 'v', mapVersion: 'm', policyDigest: policy, viewCatalogDigest: view, adapterVersion: 'a', projectionSchemaVersion: 'p', discoveryMode: 'full' }))
      .not.toBe(projectionDigestOf({ viewKey: 'v', mapVersion: 'm2', policyDigest: policy, viewCatalogDigest: view, adapterVersion: 'a', projectionSchemaVersion: 'p', discoveryMode: 'full' }))
    expect(searchIndexKeyOf({ viewKey: 'v', viewCatalogDigest: view, policyDigest: policy, tokenizerVersion: 't', indexSchemaVersion: 'i', discoveryMode: 'full' }))
      .not.toBe(searchIndexKeyOf({ viewKey: 'v2', viewCatalogDigest: view, policyDigest: policy, tokenizerVersion: 't', indexSchemaVersion: 'i', discoveryMode: 'full' }))
  })
})

describe('SkillIndex', () => {
  it('reads a view, carries managed/modelInvocable, and preserves incomplete', async () => {
    let reads = 0
    const index = new SkillIndex({
      async snapshot() {
        reads += 1
        return { skills: [summary('beta'), summary('alpha', 'other', 'user-dsh', false)], complete: false }
      },
      async managedSkillKeys() {
        return new Set([skillKeyOf(summary('alpha', 'other'))])
      },
    })
    const view = await index.read({ cwd: 'D:/work', scopeKey: 'agent-1' })
    expect(reads).toBe(1)
    expect(view.complete).toBe(false)
    const alpha = view.rows.find(row => row.name === 'alpha')
    const beta = view.rows.find(row => row.name === 'beta')
    expect(alpha).toMatchObject({ managed: true, modelInvocable: false })
    expect(beta).toMatchObject({ managed: false, modelInvocable: true })
    expect(view.catalogRevision).toMatch(/^[a-f0-9]{64}$/)
    expect(view.viewCatalogDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not cache: two reads hit the source twice', async () => {
    let reads = 0
    const index = new SkillIndex({
      async snapshot() { reads += 1; return { skills: [summary('alpha')], complete: true } },
      async managedSkillKeys() { return new Set([skillKeyOf(summary('alpha'))]) },
    })
    await index.read({ cwd: 'D:/work' })
    await index.read({ cwd: 'D:/work' })
    expect(reads).toBe(2)
  })
})


it('EVAL-007 invalidates identity on view/policy/projection changes', () => {
  const row = skillIndexRowOf(summary('alpha'), true)
  const view = viewCatalogDigestOf('v', [row], true)
  const base = { viewKey: 'v', viewCatalogDigest: view, tokenizerVersion: 't', indexSchemaVersion: 'i', discoveryMode: 'on' }
  expect(searchIndexKeyOf({ ...base, policyDigest: 'p1' })).not.toBe(searchIndexKeyOf({ ...base, policyDigest: 'p2' }))
  expect(searchIndexKeyOf({ ...base, viewCatalogDigest: 'other', policyDigest: 'p1' })).not.toBe(searchIndexKeyOf({ ...base, policyDigest: 'p1' }))
  const projection = { viewKey: 'v', policyDigest: 'p1', viewCatalogDigest: view, adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on' }
  expect(projectionDigestOf({ ...projection, mapVersion: 'm1' })).not.toBe(projectionDigestOf({ ...projection, mapVersion: 'm2' }))
})


it('policyDigest canonicalizes Set content instead of serializing to {}', () => {
  const left = policyDigestOf({ globalPolicyRevision: 'g', effectivePolicy: { mode: 'auto', disabled: new Set(['a']) } })
  const right = policyDigestOf({ globalPolicyRevision: 'g', effectivePolicy: { mode: 'auto', disabled: new Set(['b']) } })
  const same = policyDigestOf({ globalPolicyRevision: 'g', effectivePolicy: { mode: 'auto', disabled: new Set(['a']) } })
  expect(left).not.toBe(right)
  expect(left).toBe(same)
})


it('forwards the platform scope to the snapshot source', async () => {
  const scope = { kind: 'agent', id: 'a1' }
  let seen: unknown
  const index = new SkillIndex({
    async snapshot(query) { seen = query.scope; return { skills: [], complete: true } },
    async managedSkillKeys() { return new Set() },
  })
  await index.read({ cwd: 'D:/work', scopeKey: 'a1', scope })
  expect(seen).toBe(scope)
})
