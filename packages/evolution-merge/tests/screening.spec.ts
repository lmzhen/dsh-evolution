// @tier pre-tag
import { expect, it } from 'vitest'
import { lexicalCandidates, nameEntropy, prefilter, type SkillCard } from '../src/index.ts'

const card = (name: string, body: string, description = 'same description'): SkillCard => ({ name, description, body })

it('finds a lexical pair with body/summary arms', () => {
  const result = lexicalCandidates([
    card('alpha-skill', 'run pytest and debug python tests'),
    card('beta-skill', 'run pytest and debug python tests'),
    card('gamma-skill', 'completely different content'),
  ])
  expect(result.stats).toMatchObject({ skills: 3, filtered: 0, candidates: 1 })
  expect(result.candidates[0]).toMatchObject({ a: 'alpha-skill', b: 'beta-skill', source: 'lexical' })
  expect(result.candidates[0]?.arms).toContain('body')
})

it('prefilters short/low-entropy names but leaves real names', () => {
  expect(nameEntropy('aaaa')).toBe(0)
  const kept = prefilter([card('alpha-skill', 'x'), card('short', 'x'), card('a', 'x')])
  expect(kept.map(item => item.name)).toEqual(['alpha-skill'])
})

it('caps candidates and returns deterministic ordering', () => {
  const result = lexicalCandidates([
    card('alpha-skill', 'same body'),
    card('beta-skill', 'same body'),
    card('gamma-skill', 'same body'),
  ], { maxCandidates: 2 })
  expect(result.candidates).toHaveLength(2)
  expect(result.candidates.map(pair => pair.a)).toEqual(['alpha-skill', 'alpha-skill'])
})
