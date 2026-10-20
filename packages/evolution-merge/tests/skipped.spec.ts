// @tier pre-tag
import { expect, it } from 'vitest'
import { pairKey, rowIdOf, skippedPairKeys, type MergeRow } from '../src/index.ts'

const row = (a: string, b: string, createdAt: string): MergeRow => {
  const key = pairKey(a, b)
  return { id: rowIdOf(key), pairKey: key, a, b, state: 'skipped', queue: 'skipped', createdAt, updatedAt: createdAt }
}

it('filters skipped pairs until the ttl expires', () => {
  const now = Date.parse('2026-10-20T00:00:00.000Z')
  const old = row('alpha-skill', 'beta-skill', '2026-10-01T00:00:00.000Z')
  const fresh = row('gamma-skill', 'delta-skill', '2026-10-19T00:00:00.000Z')
  const keys = skippedPairKeys([old, fresh], 7, now)
  expect(keys.has(old.pairKey)).toBe(false)
  expect(keys.has(fresh.pairKey)).toBe(true)
  expect(skippedPairKeys([old], 0, now).has(old.pairKey)).toBe(true)
})
