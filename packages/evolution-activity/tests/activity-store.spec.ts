import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import { nodeEvolutionIo, transactIo, type EvolutionIoLike, type EvolutionPlanAppliedEvent } from '@deepseek-ai/dsh-evolution-core'
import { ACTIVITY_FILE_VERSION, DEFAULT_MAX_ITEMS, activityFile, apply, applyActivityEvent, loadActivity, parseActivityContent, type EvolutionActivityRecord } from '../src/index.ts'

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

/** In-memory backend. With `withTransact` it serializes RMW like the node file
 * lock — each task delays inside the lock, so interleaving would be certain
 * without it. */
function fakeIo(withTransact: boolean): EvolutionIoLike {
  let content: string | null = null
  let tail: Promise<unknown> = Promise.resolve()
  const io: EvolutionIoLike = {
    readText: async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return content
    },
    writeText: async (_path, next) => {
      await new Promise(resolve => setTimeout(resolve, 5))
      content = next
    },
    remove: async () => {
      content = null
    },
    list: async () => [],
    exists: async () => content !== null,
    rename: async () => {},
    copy: async () => {},
  }
  if (withTransact) {
    io.transact = (_path, task) => {
      // Backend lock: serialize task entry, then run the RMW inside it.
      const run = tail.then(async () => {
        const next = await task(content)
        if (next === null) content = null
        else content = next
      })
      tail = run.then(() => undefined, () => undefined)
      return run
    }
  }
  return io
}

function serialize(items: EvolutionActivityRecord[]): string {
  return JSON.stringify({ version: ACTIVITY_FILE_VERSION, items }, null, 2)
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

  it('concurrent folds inside transact never drop a record (N-4)', async () => {
    const io = fakeIo(true)
    const file = activityFile('root')
    // Two "processes" fold concurrently: each reads inside the backend lock,
    // so the second sees the first's fold instead of resurrecting an empty list.
    await Promise.all([
      transactIo(io, file, async current => serialize(applyActivityEvent(parseActivityContent(current), payload({ planId: 'a1' }), 10))),
      transactIo(io, file, async current => serialize(applyActivityEvent(parseActivityContent(current), payload({ planId: 'b1' }), 10))),
    ])
    const items = parseActivityContent(await io.readText(file))
    expect(items.map(item => item.planId).sort()).toEqual(['a1', 'b1'])
  })

  it('falls back to plain read+write when the backend has no transact (N-4)', async () => {
    const io = fakeIo(false)
    const file = activityFile('root')
    await transactIo(io, file, async current => serialize(applyActivityEvent(parseActivityContent(current), payload(), 10)))
    expect(await io.readText(file)).toContain('plan-1')
  })
  it('clamps a non-positive maxItems so the sidecar stays bounded (rc.42 regression)', () => {

    // slice(-0) keeps EVERYTHING: a zero cap used to disable the window.

    let items: EvolutionActivityRecord[] = []

    items = applyActivityEvent(items, payload({ planId: 'p1' }), 0, 100)

    items = applyActivityEvent(items, payload({ planId: 'p2' }), 0, 200)

    expect(items.map(item => item.planId)).toEqual(['p2'])

  })

  it('falls back to the default bound when maxItems is not finite (S6.4)', () => {

    // slice(-NaN) keeps EVERYTHING: a NaN cap would disable the window just
    // like a zero cap. The fold falls back to DEFAULT_MAX_ITEMS so the sidecar
    // never loses its bound. The apply() warn owns the diagnostic for NaN config.
    let items: EvolutionActivityRecord[] = []

    items = applyActivityEvent(items, payload({ planId: 'p1' }), Number.NaN, 100)

    items = applyActivityEvent(items, payload({ planId: 'p2' }), Number.POSITIVE_INFINITY, 200)

    expect(items.map(item => item.planId)).toEqual(['p1', 'p2'])

    // Both record exactly the DEFAULT_MAX_ITEMS window (bounded, not everything).
    for (let i = 0; i < DEFAULT_MAX_ITEMS + 5; i += 1) {
      items = applyActivityEvent(items, payload({ planId: `p${i}` }), Number.NaN, 300 + i)
    }
    expect(items).toHaveLength(DEFAULT_MAX_ITEMS)
  })

  it('a NaN maxItems config keeps the driver bounded instead of disabling the window (S6.4)', { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-activity-nan-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      // `typeof NaN === 'number'` so schemastery accepts it; apply must warn and
      // fall back to the default bound rather than disable the window.
      await ctx.plugin(apply, { maxItems: Number.NaN })
      ctx.emit('evolution/plan-applied', payload({ planId: 'n1' }))
      ctx.emit('evolution/plan-applied', payload({ planId: 'n2' }))
      ctx.emit('evolution/plan-applied', payload({ planId: 'n3' }))
      const items = await pollUntil(root, 'n3')
      expect(items.map(item => item.planId)).toEqual(['n1', 'n2', 'n3'])
      await ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(root, { recursive: true, force: true })
    }
  })

})
