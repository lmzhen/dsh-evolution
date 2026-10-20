// @tier pre-tag
import { expect, it } from 'vitest'
import { proposePairs, type ModelPort, type SkillCard } from '../src/index.ts'

const card = (name: string): SkillCard => ({ name, description: 'description', body: 'body' })
const cards = [card('alpha-skill'), card('beta-skill'), card('gamma-skill')]
const signal = new AbortController().signal

it('keeps only known, deduplicated pairs with a reason', async () => {
  const port: ModelPort = {
    async callJson() {
      return { pairs: [
        { a: 'beta-skill', b: 'alpha-skill', reason: 'same topic' },
        { a: 'alpha-skill', b: 'beta-skill', reason: 'duplicate' },
        { a: 'alpha-skill', b: 'unknown-skill', reason: 'bad' },
        { a: 'alpha-skill', b: 'alpha-skill', reason: 'self' },
      ] }
    },
  }
  const result = await proposePairs(cards, port, { signal })
  expect(result.shards).toBe(1)
  expect(result.candidates).toEqual([{ a: 'alpha-skill', b: 'beta-skill', source: 'proposed', reason: 'same topic' }])
})

it('shards a large library and survives a failed shard', async () => {
  let calls = 0
  const port: ModelPort = {
    async callJson() {
      calls += 1
      if (calls === 2) throw new Error('model down')
      return { pairs: [] }
    },
  }
  const many = Array.from({ length: 6 }, (_, index) => card('skill-number-' + String(index)))
  const result = await proposePairs(many, port, { signal, shardSize: 2 })
  expect(calls).toBe(3)
  expect(result.shards).toBe(3)
  expect(result.degraded).toHaveLength(1)
})
