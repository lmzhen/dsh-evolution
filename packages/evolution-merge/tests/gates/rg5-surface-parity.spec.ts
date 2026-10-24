// @tier pre-tag
import { expect, it } from 'vitest'
import { buildFacts } from '../../src/facts.ts'
import { MERGE_COMMAND_SURFACE } from '../../src/command-surface.ts'
import { formatFacts } from '../../src/status.ts'
import { toQueuePage } from '../../src/wire-projection.ts'
import type { MergeRow } from '../../src/contracts.ts'

const rows: MergeRow[] = [
  { id: 'v', pairKey: 'a|b', a: 'a', b: 'b', state: 'verify', queue: 'verify', createdAt: 'x', updatedAt: 'x' },
  { id: 'p', pairKey: 'c|d', a: 'c', b: 'd', state: 'pending', queue: 'pending', createdAt: 'x', updatedAt: 'x' },
  { id: 's', pairKey: 'e|f', a: 'e', b: 'f', state: 'skipped', queue: 'skipped', createdAt: 'x', updatedAt: 'x' },
]

it('CLI Facts and HTTP QueuePage share the same counts and fallback', () => {
  const facts = buildFacts({ rows, runs: [], approval: false, readAt: 1 })
  const verify = toQueuePage(rows, 'verify', false, 1)
  const pending = toQueuePage(rows, 'pending', false, 1)
  expect(verify.counts).toEqual(facts.counts)
  expect(pending.counts).toEqual(facts.counts)
  expect(formatFacts(facts)).toContain('verify 1, pending 1')
  expect(facts.fallback).toEqual(MERGE_COMMAND_SURFACE.fallback)
  expect(facts.fallback.length).toBeGreaterThanOrEqual(7)
})
