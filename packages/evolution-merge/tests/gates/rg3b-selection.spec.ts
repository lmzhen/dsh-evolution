// @tier pre-tag
import { expect, it } from 'vitest'
import { filterSelection } from '../../src/domain/selection-policy.ts'
import { withDecisionRevisions } from '../../src/revision.ts'
import type { SkillCard } from '../../src/skill-card.ts'

const managed = (name: string): SkillCard => ({ name, body: name, managed: true, files: [{ path: 'references/' + name + '.md', content: name }] })

it('filters non-managed/protected KEEP out of skipped before writing', () => {
  const selection = { candidates: [], skipped: [{ pairKey: 'a', a: 'a', b: 'b' }, { pairKey: 'x', a: 'x', b: 'y' }], reportOnly: [] }
  const filtered = filterSelection(selection, name => name === 'a' || name === 'b', name => name === 'b')
  expect(filtered.skipped).toEqual([])
  const managedOnly = filterSelection(selection, name => name === 'a' || name === 'b', () => false)
  expect(managedOnly.skipped).toEqual([{ pairKey: 'a', a: 'a', b: 'b' }])
})

it('decision carries revision refs and support digest', () => {
  const cards = [managed('a'), managed('b')]
  const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }
  const withRefs = withDecisionRevisions(decision, cards, 'a', 'b')
  expect(withRefs.targetRevisionRef.kind).toBe('present')
  expect(withRefs.sourceRevisionRef.kind).toBe('present')
  expect(withRefs.supportDigest).toMatch(/^[a-f0-9]{64}$/)
})
