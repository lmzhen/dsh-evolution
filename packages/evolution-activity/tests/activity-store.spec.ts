import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import { nodeEvolutionIo, type EvolutionPlanAppliedEvent } from '@deepseek-ai/dsh-evolution-core'
import { ACTIVITY_FILE_VERSION, activityFile, apply, applyActivityEvent, loadActivity, type EvolutionActivityRecord } from '../src/index.ts'

function payload(overrides: Partial<EvolutionPlanAppliedEvent> = {}): EvolutionPlanAppliedEvent {
  return {
    sessionId: 'session-a',
    planId: 'plan-1',
    policyFingerprint: 'fp-1',
    memoryApplied: 1,
    skillApplied: 2,
    rejectedOps: 3,
    evidenceQuotes: 4,
    estimatedInputChars: 5000,
    ...overrides,
  }
}


/** Poll until the sidecar contains `lastPlanId` (io write lock retries at 50ms). */
async function pollUntil(root: string, lastPlanId: string, timeoutMs = 8_000): Promise<EvolutionActivityRecord[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const items = await loadActivity(join(root, 'evolution'), nodeEvolutionIo())
    if (items.some(item => item.planId === lastPlanId) || Date.now() > deadline) return items
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

describe('evolution-activity store', () => {
  it('folds plan-applied payloads into a bounded record list (pure fold)', () => {
    let items: EvolutionActivityRecord[] = []
    items = applyActivityEvent(items, payload(), 20, 100)
    items = applyActivityEvent(items, payload({ planId: 'plan-2', sessionId: 'session-b' }), 20, 200)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ sessionId: 'session-a', planId: 'plan-1', memoryApplied: 1, at: 100 })
    // Cap drops the OLDEST records, keeping the recent window.
    items = applyActivityEvent(items, payload({ planId: 'plan-3' }), 2, 300)
    expect(items.map(item => item.planId)).toEqual(['plan-2', 'plan-3'])
  })

  it('persists every emitted plan-applied payload across driver restarts (A1 replacement read path)', { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-activity-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      const first = new Context()
      await first.plugin(EvolutionIoRegistry)
      await first.plugin(NodeIo)
      await first.plugin(apply, { maxItems: 10 })
      first.emit('evolution/plan-applied', payload())
      first.emit('evolution/plan-applied', payload({ planId: 'plan-2', sessionId: 'session-b', policyFingerprint: undefined }))
      await pollUntil(root, 'plan-2')
      await first.fiber.dispose()

      // Driver restart (new context over the same DSH_HOME) must MERGE with
      // the existing sidecar, never overwrite it — the store is the durable
      // replacement for the retired session projection.
      const second = new Context()
      await second.plugin(EvolutionIoRegistry)
      await second.plugin(NodeIo)
      await second.plugin(apply, { maxItems: 10 })
      second.emit('evolution/plan-applied', payload({ planId: 'plan-3', sessionId: 'session-c' }))
      await pollUntil(root, 'plan-3')
      await second.fiber.dispose()

      // The driver persists under $DSH_HOME/evolution (evolutionHome()).
      const items = await loadActivity(join(root, 'evolution'), nodeEvolutionIo())
      expect(items.map(item => item.planId)).toEqual(['plan-1', 'plan-2', 'plan-3'])
      expect(items[0]).toMatchObject({
        sessionId: 'session-a',
        policyFingerprint: 'fp-1',
        memoryApplied: 1,
        skillApplied: 2,
        rejectedOps: 3,
      })
      expect(typeof items[0]?.at).toBe('number')
      // Versioned on-disk shape.
      const raw = JSON.parse(await readFile(join(root, 'evolution', 'activity.json'), 'utf8')) as { version?: number }
      expect(raw.version).toBe(ACTIVITY_FILE_VERSION)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(root, { recursive: true, force: true })
    }
  })

  it('caps the sidecar at maxItems and tolerates a malformed file', { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-activity-cap-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      // Malformed sidecar reads as empty instead of crashing the driver.
      await nodeEvolutionIo().writeText(activityFile(join(root, 'evolution')), '{not json')
      expect(await loadActivity(join(root, 'evolution'), nodeEvolutionIo())).toEqual([])

      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      await ctx.plugin(apply, { maxItems: 2 })
      ctx.emit('evolution/plan-applied', payload({ planId: 'p1' }))
      ctx.emit('evolution/plan-applied', payload({ planId: 'p2' }))
      ctx.emit('evolution/plan-applied', payload({ planId: 'p3' }))
      // maxItems=2: the fold keeps the most recent two; the sidecar never
      // grows past the cap, so poll for the steady-state 2 records.
      const items = await pollUntil(root, 'plan-2')
      expect(items.map(item => item.planId)).toEqual(['p2', 'p3'])


    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does nothing (no throw) without an evolution IO provider', async () => {
    const ctx = new Context()
    await ctx.plugin(apply, {})
    ctx.emit('evolution/plan-applied', payload())
    await new Promise(resolve => setTimeout(resolve, 10))
    await ctx.fiber.dispose()
  })
})
