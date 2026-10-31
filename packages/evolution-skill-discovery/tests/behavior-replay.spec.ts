// @tier ci-only
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { computeBehaviorMetrics, type DiscoveryBehaviorObservation } from '../src/index.ts'

it('replays a behavior observation fixture and recomputes metrics', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/behavior-observations.json', import.meta.url), 'utf8')) as { schemaVersion: number; observations: DiscoveryBehaviorObservation[] }
  expect(fixture.schemaVersion).toBe(1)
  const metrics = computeBehaviorMetrics(fixture.observations)
  expect(metrics.total).toBe(10)
  expect(metrics.tokens).toBeGreaterThan(0)
  expect(metrics.taskSuccess).not.toBeNull()
  expect(metrics.awarenessRecall).not.toBeNull()
})
