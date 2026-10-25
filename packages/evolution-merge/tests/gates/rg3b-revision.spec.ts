// @tier pre-tag
import { expect, it } from 'vitest'
import { targetRevisionRefOf, sourceRevisionRefOf, revisionMismatch, supportDigestOf } from '../../src/revision.ts'
import { criteriaFrom } from '../../src/domain/engine-criteria.ts'
import { normalizeProviderKey } from '../../src/domain/provider-key.ts'
import type { SkillCard } from '../../src/skill-card.ts'

const card = (name: string, body: string): SkillCard => ({ name, body, managed: true })

it('uses absent/present revision sentinels', () => {
  expect(targetRevisionRefOf([], 'missing')).toEqual({ kind: 'absent' })
  const present = targetRevisionRefOf([card('a', 'body')], 'a')
  expect(present.kind).toBe('present')
  if (present.kind === 'present') expect(present.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(sourceRevisionRefOf([card('a', 'a')], 'a', 'b')).toEqual({ kind: 'absent' })
})

it('maps engine criteria from level/verdict/action', () => {
  expect(criteriaFrom('L0', 1, 'keep').validation).toBe('report-only')
  expect(criteriaFrom('L1', 0, 'merge').commit).toBe('never')
  expect(criteriaFrom('L2', 1, 'merge')).toMatchObject({ decision: 'merge', validation: 'required', commit: 'required', archive: 'sources', evidence: 'receipt' })
  expect(criteriaFrom('L2', -1, 'keep')).toMatchObject({ decision: 'keep', commit: 'never' })
})

it('normalizes provider keys and fails loud on unknown syntax', () => {
  expect(normalizeProviderKey(' DeepSeek ')).toBe('deepseek')
  expect(normalizeProviderKey('openai.gpt-5')).toBe('openai.gpt-5')
  expect(() => normalizeProviderKey('bad provider')).toThrow('provider key is invalid')
  expect(() => normalizeProviderKey('provider/name')).toThrow('provider key is invalid')
  expect(() => normalizeProviderKey('provider:name')).toThrow('provider key is invalid')
  expect(() => normalizeProviderKey('')).toThrow('provider key is invalid')
})

it('maps target create/absent/present/occupied sentinel matrix to target-taken', () => {
  expect(revisionMismatch({ kind: 'absent' }, { kind: 'absent' })).toBeNull()
  expect(revisionMismatch({ kind: 'absent' }, { kind: 'present', sha256: 'x' })).toBe('target-taken')
  expect(revisionMismatch({ kind: 'present', sha256: 'x' }, { kind: 'absent' })).toBe('target-taken')
  expect(revisionMismatch({ kind: 'present', sha256: 'x' }, { kind: 'present', sha256: 'y' })).toBe('target-taken')
  expect(revisionMismatch({ kind: 'present', sha256: 'x' }, { kind: 'present', sha256: 'x' })).toBeNull()
  expect(revisionMismatch(undefined, { kind: 'present', sha256: 'x' })).toBeNull()
})

it('changes supportDigest when support content changes', () => {
  const a = { name: 'a', body: 'a', managed: true, files: [{ path: 'references/a.md', content: 'one' }] }
  const b = { name: 'b', body: 'b', managed: true, files: [] }
  const changed = { ...a, files: [{ path: 'references/a.md', content: 'two' }] }
  expect(supportDigestOf([a, b], ['a', 'b'])).not.toBe(supportDigestOf([changed, b], ['a', 'b']))
})
