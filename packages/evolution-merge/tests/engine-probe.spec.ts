// @tier pre-tag
import { expect, it } from 'vitest'
import { probe } from '@deepseek-ai/dsh-evolution-merge-engine'

it('engine probe exposes the judge gate and a ranker alongside screening', () => {
  const state = probe()
  expect(typeof state.judge).toBe('string')
  expect(state.judge.length).toBeGreaterThan(0)
  expect(typeof state.ranker).toBe('string')
  expect(state.ranker.length).toBeGreaterThan(0)
})
