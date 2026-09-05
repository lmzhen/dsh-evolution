import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import * as Feedback from '../src/index.ts'
import { appendEvolutionEvent, readEvolutionEvents } from '@deepseek-ai/dsh-evolution-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('evolution-feedback', () => {
  it('exports the function-plugin namespace without a default export', () => {
    // The Loader's unwrapExports prefers `.default` and discards the rest of
    // the namespace: a stray `export default` makes the row load the bare
    // class instead of the plugin and the evolutionFeedback service never
    // activates. `ctx.plugin(namespace)` hides the bug, so assert the shape.
    expect('default' in Feedback).toBe(false)
    expect(typeof Feedback.apply).toBe('function')
    expect(typeof Feedback.name).toBe('string')
    expect(Feedback.Config).toBeDefined()
  })

  it('computes quality score from positive and negative feedback', async () => {
    const ctx = new Context()
    await ctx.plugin(Feedback)
    ctx.evolutionFeedback.record('python-testing', 'positive')
    ctx.evolutionFeedback.record('python-testing', 'positive')
    ctx.evolutionFeedback.record('python-testing', 'negative')
    expect(ctx.evolutionFeedback.score('python-testing')).toBeCloseTo(1 / 3)
  })

  it('persists across restarts and feeds quality_score into skill usage', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root: join(home, 'skills') })
    await ctx.skillUsage.record('python-testing', 'use')
    await ctx.plugin(Feedback)
    ctx.evolutionFeedback.record('python-testing', 'positive', undefined, 'skill')
    ctx.evolutionFeedback.record('python-testing', 'negative', undefined, 'skill')
    ctx.evolutionFeedback.record('python-testing', 'negative', undefined, 'skill')
    // give the serialized persistence/quality writes a chance to settle
    await ctx.evolutionFeedback.waitIdle()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect((await ctx.skillUsage.report()).get('python-testing')?.quality_warn).toBe(true)

    const ctx2 = new Context()
    await ctx2.plugin(EvolutionIoRegistry)
    await ctx2.plugin(NodeIo)
    await ctx2.plugin(Feedback)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(ctx2.evolutionFeedback.score('python-testing', 'skill')).toBeCloseTo(-1 / 3)
    expect(ctx2.evolutionFeedback.snapshot().sessions).toEqual({})

    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('a record made before restore settles survives the restore (merge, not replace)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-race-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const io = ctx.evolutionIo.provider('node')
    const path = join(home, 'evolution', 'feedback.json')
    // Pre-existing aggregate state: one old positive (legacy v1 shape).
    await io.writeText(path, JSON.stringify({ skills: { 'old-skill': { positive: 1, negative: 0 } }, sessions: {} }))
    const feedback = new Feedback.EvolutionFeedback(io, home)
    // Simulate the startup race: restore is already in flight when a record lands.
    const restoring = feedback.restore(io)
    feedback.record('new-skill', 'positive', undefined, 'skill')
    await restoring
    await new Promise(resolve => setTimeout(resolve, 20))
    const snapshot = feedback.snapshot()
    expect(snapshot.skills['new-skill']).toBeDefined()
    expect(snapshot.skills['old-skill']?.positive).toBe(1)
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('ignores a malformed aggregate and still records into the event log', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-bad-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(home, 'evolution', 'feedback.json'), '{broken')
    await ctx.plugin(Feedback)
    await new Promise(resolve => setTimeout(resolve, 20))
    ctx.evolutionFeedback.record('session-1', 'positive')
    expect(ctx.evolutionFeedback.score('session-1')).toBe(1)
    // The record task is async (locked RMW); wait for it before teardown so a
    // slow CI cannot rm a directory the task is still writing into.
    await ctx.evolutionFeedback.waitIdle()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('two instances recording the same target never lose an increment in the event log (rc.68)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-rc68-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      const a = new Feedback.EvolutionFeedback(io, home)
      const b = new Feedback.EvolutionFeedback(io, home)
      // Two "processes" record the same skill concurrently: each append runs
      // inside the transact, so both counts survive in the log.
      for (let i = 0; i < 4; i += 1) {
        a.record('shared-skill', 'positive', undefined, 'skill')
        b.record('shared-skill', 'positive', undefined, 'skill')
      }
      await Promise.all([a.waitIdle(), b.waitIdle()])
      const disk = JSON.parse(await io.readText(join(home, 'evolution', 'events.json')) ?? '{}') as { events: Array<{ type?: string; target?: string; rating?: string }> }
      const hits = disk.events.filter(event => event.type === 'feedback' && event.target === 'shared-skill' && event.rating === 'positive')
      expect(hits).toHaveLength(8)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('migrates the legacy aggregate into the event log once and rebuilds the cache (rc.68)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-migrate-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const io = ctx.evolutionIo.provider('node')
    const cachePath = join(home, 'evolution', 'feedback.json')
    const eventsPath = join(home, 'evolution', 'events.json')
    await io.writeText(cachePath, JSON.stringify({ skills: { 'old-skill': { positive: 2, negative: 1, lastNote: 'keep me' } }, sessions: {} }))
    const first = new Feedback.EvolutionFeedback(io, home)
    await first.restore(io)
    await first.waitIdle()
    expect(first.snapshot().skills['old-skill']).toMatchObject({ positive: 2, negative: 1, lastNote: 'keep me' })
    const eventsRaw = JSON.parse(await io.readText(eventsPath) ?? '{}') as { events: Array<{ seq: number; type?: string; rating?: string }> }
    expect(eventsRaw.events).toHaveLength(3)
    expect(eventsRaw.events.filter(event => event.rating === 'positive')).toHaveLength(2)
    expect(eventsRaw.events.every(event => typeof event.seq === 'number')).toBe(true)
    // Idempotent: a second boot does not duplicate the log.
    const second = new Feedback.EvolutionFeedback(io, home)
    await second.restore(io)
    await second.waitIdle()
    const once = JSON.parse(await io.readText(eventsPath) ?? '{}') as { events: unknown[] }
    expect(once.events).toHaveLength(3)
    // The boot cache is now v2 with the truth fold.
    const cache = JSON.parse(await io.readText(cachePath) ?? '{}') as { version?: number; lastSeq?: number }
    expect(cache.version).toBe(2)
    expect(cache.lastSeq).toBe(3)
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('an append after a booted cache does not double-count at the next boot (rc.68)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-delta-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      const first = new Feedback.EvolutionFeedback(io, home)
      await first.restore(io)
      first.record('shared-skill', 'positive', undefined, 'skill')
      await first.waitIdle()
      // Second boot: the cache was written from the TRUTH (event fold only),
      // so the incremental fold must yield exactly one count.
      const second = new Feedback.EvolutionFeedback(io, home)
      await second.restore(io)
      await second.waitIdle()
      expect(second.snapshot().skills['shared-skill']?.positive).toBe(1)
      // And a fresh fold of the log agrees with the cached view.
      const eventsRaw = JSON.parse(await io.readText(join(home, 'evolution', 'events.json')) ?? '{}') as { events: Array<{ rating?: string }> }
      expect(eventsRaw.events.filter(event => event.rating === 'positive')).toHaveLength(1)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('a concurrent first append does not lose the legacy aggregate (rc.69 migration merge)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-merge-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      const cachePath = join(home, 'evolution', 'feedback.json')
      const eventsPath = join(home, 'evolution', 'events.json')
      // Legacy aggregate + a concurrent writer that created the log FIRST —
      // the migration transact must APPEND, never drop, the legacy sequence.
      await io.writeText(cachePath, JSON.stringify({ skills: { 'old-skill': { positive: 2, negative: 1 } }, sessions: {} }))
      await appendEvolutionEvent(io, eventsPath, { type: 'feedback', target: 'new-skill', kind: 'skill', rating: 'positive' })
      const aggregate = JSON.parse(await io.readText(cachePath) ?? '{}') as { skills: Record<string, { positive: number; negative: number }> }
      await Feedback.migrateFeedbackEvents(io, eventsPath, aggregate)
      const events = (await readEvolutionEvents(io, eventsPath)).events
      expect(events).toHaveLength(4)
      // A second migration is idempotent (the log already starts with the sequence).
      await Feedback.migrateFeedbackEvents(io, eventsPath, aggregate)
      expect((await readEvolutionEvents(io, eventsPath)).events).toHaveLength(4)
      // And a full restore from the merged log yields both sides.
      const feedback = new Feedback.EvolutionFeedback(io, home)
      await feedback.restore(io)
      await feedback.waitIdle()
      expect(feedback.snapshot().skills['old-skill']).toMatchObject({ positive: 2, negative: 1 })
      expect(feedback.snapshot().skills['new-skill']?.positive).toBe(1)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('an empty legacy aggregate does not create an events file (rc.70 F-4)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-empty-agg-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      const eventsPath = join(home, 'evolution', 'events.json')
      await Feedback.migrateFeedbackEvents(io, eventsPath, { skills: {}, sessions: {} })
      expect(await io.readText(eventsPath)).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('archives suppress legacy migration: a deleted active is not re-synthesized (rc.71)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-archive-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      const eventsPath = join(home, 'evolution', 'events.json')
      // Truth lives in the archive (seq 1-2); the active is gone.
      await io.writeText(join(home, 'evolution', 'events-2.json'), JSON.stringify({ version: 1, events: [
        { seq: 1, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: 'old-skill', kind: 'skill', rating: 'negative' },
        { seq: 2, at: '2026-01-01T00:00:01.000Z', type: 'feedback', target: 'old-skill', kind: 'skill', rating: 'positive' },
      ] }, null, 2))
      // A legacy aggregate that WOULD be synthesized if migration ran.
      await io.writeText(join(home, 'evolution', 'feedback.json'), JSON.stringify({ skills: { 'ghost-skill': { positive: 5, negative: 0 } }, sessions: {} }))
      const feedback = new Feedback.EvolutionFeedback(io, home)
      await feedback.restore(io)
      await feedback.waitIdle()
      // Migration suppressed: the ghost aggregate never materializes, the
      // archive timeline is the truth, and the active stays absent.
      expect(feedback.snapshot().skills['ghost-skill']).toBeUndefined()
      expect(feedback.snapshot().skills['old-skill']).toMatchObject({ positive: 1, negative: 1 })
      expect(await io.readText(eventsPath)).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('a cache below the timeline floor is ignored, never partially folded (rc.72 G-3)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-floor-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      // The timeline only holds seqs 5-6 — everything below is a pruned window.
      await io.writeText(join(home, 'evolution', 'events.json'), JSON.stringify({ version: 1, events: [
        { seq: 5, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: 'x', kind: 'skill', rating: 'negative' },
        { seq: 6, at: '2026-01-01T00:00:01.000Z', type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' },
      ] }, null, 2))
      // A cache whose lastSeq fell below the retained window — using it would
      // fabricate a partial fold; the full fold must win.
      await io.writeText(join(home, 'evolution', 'feedback.json'), JSON.stringify({ version: 2, lastSeq: 1, skills: { x: { positive: 99, negative: 0 } }, sessions: {} }, null, 2))
      const feedback = new Feedback.EvolutionFeedback(io, home)
      await feedback.restore(io)
      await feedback.waitIdle()
      expect(feedback.snapshot().skills['x']).toMatchObject({ positive: 1, negative: 1 })
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('an empty event log is rebuilt on the next record (rc.69)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-empty-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      const eventsPath = join(home, 'evolution', 'events.json')
      await io.writeText(eventsPath, '')
      const feedback = new Feedback.EvolutionFeedback(io, home)
      await feedback.restore(io)
      feedback.record('session-1', 'positive')
      await feedback.waitIdle()
      const read = await readEvolutionEvents(io, eventsPath)
      expect(read.malformed).toBe(false)
      expect(read.events).toHaveLength(1)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('a malformed event log refuses appends and keeps its bytes (rc.65 posture)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-events-bad-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      const eventsPath = join(home, 'evolution', 'events.json')
      await io.writeText(eventsPath, '{corrupt log')
      const feedback = new Feedback.EvolutionFeedback(io, home)
      await feedback.restore(io)
      feedback.record('session-1', 'positive')
      await feedback.waitIdle()
      expect(await io.readText(eventsPath)).toBe('{corrupt log')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('skips a feedback event with an invalid rating instead of folding NaN (S6.4)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-badrating-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      const eventsPath = join(home, 'evolution', 'events.json')
      await io.writeText(eventsPath, JSON.stringify({ version: 1, events: [
        { seq: 1, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: 'x', kind: 'skill', rating: 'garbage' },
        { seq: 2, at: '2026-01-01T00:00:01.000Z', type: 'feedback', target: 'y', kind: 'skill', rating: 'positive' },
      ] }, null, 2))
      const warns: string[] = []
      const feedback = new Feedback.EvolutionFeedback(io, home, undefined, message => warns.push(message))
      await feedback.restore(io)
      await feedback.waitIdle()
      // The invalid rating is skipped (never NaN) and reported through warn.
      expect(feedback.snapshot().skills['x']).toBeUndefined()
      expect(feedback.snapshot().skills['y']).toMatchObject({ positive: 1, negative: 0 })
      expect(warns.some(message => message.includes('invalid rating'))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('skips cache records with an invalid numeric domain (S6.4)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-badcache-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      const eventsPath = join(home, 'evolution', 'events.json')
      // A non-empty log makes the cache the fold base (no migration), so the
      // cached aggregates are what parseCache validation governs.
      await io.writeText(eventsPath, JSON.stringify({ version: 1, events: [
        { seq: 1, at: '2026-01-01T00:00:00.000Z', type: 'feedback', target: 'seed', kind: 'skill', rating: 'positive' },
      ] }, null, 2))
      await io.writeText(join(home, 'evolution', 'feedback.json'), JSON.stringify({
        version: 2,
        lastSeq: 1,
        skills: {
          good: { positive: 5, negative: 0, lastNote: 'ok' },
          badnan: { positive: NaN, negative: 0 },
          badneg: { positive: 0, negative: -2 },
        },
        sessions: {},
      }, null, 2))
      const warns: string[] = []
      const feedback = new Feedback.EvolutionFeedback(io, home, undefined, message => warns.push(message))
      await feedback.restore(io)
      await feedback.waitIdle()
      // Valid record survives; NaN/negative records are dropped, never folded.
      expect(feedback.snapshot().skills['good']).toMatchObject({ positive: 5, negative: 0, lastNote: 'ok' })
      expect(feedback.snapshot().skills['badnan']).toBeUndefined()
      expect(feedback.snapshot().skills['badneg']).toBeUndefined()
      expect(warns.some(message => message.includes('finite numbers >= 0'))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('migrates a zero-count legacy record without dropping its note (S6.4)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-noteonly-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      const cachePath = join(home, 'evolution', 'feedback.json')
      const eventsPath = join(home, 'evolution', 'events.json')
      await io.writeText(cachePath, JSON.stringify({ skills: { noteonly: { positive: 0, negative: 0, lastNote: 'keep-note' } }, sessions: {} }))
      const feedback = new Feedback.EvolutionFeedback(io, home)
      await feedback.restore(io)
      await feedback.waitIdle()
      // The note is preserved, represented as a single positive note event so
      // it survives the migration into the event log.
      expect(feedback.snapshot().skills['noteonly']).toMatchObject({ positive: 1, negative: 0, lastNote: 'keep-note' })
      const eventsRaw = JSON.parse(await io.readText(eventsPath) ?? '{}') as { events: Array<{ rating?: string; note?: string }> }
      expect(eventsRaw.events).toHaveLength(1)
      expect(eventsRaw.events[0]).toMatchObject({ rating: 'positive', note: 'keep-note' })
      // Idempotent: a second boot does not duplicate the note event.
      const second = new Feedback.EvolutionFeedback(io, home)
      await second.restore(io)
      await second.waitIdle()
      const once = JSON.parse(await io.readText(eventsPath) ?? '{}') as { events: unknown[] }
      expect(once.events).toHaveLength(1)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('reclaims the optimistic count after a failed append (S6.4 E-8)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-feedback-rollback-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const io = ctx.evolutionIo.provider('node')
      const eventsPath = join(home, 'evolution', 'events.json')
      await io.writeText(eventsPath, '{corrupt log')
      const feedback = new Feedback.EvolutionFeedback(io, home)
      await feedback.restore(io)
      feedback.record('y', 'positive', undefined, 'skill')
      // A failed append must not leave a phantom optimistic count in memory:
      // the log is the truth, so the count rolls back instead of lingering.
      await feedback.waitIdle()
      expect(feedback.score('y', 'skill')).toBe(0)
      expect(await io.readText(eventsPath)).toBe('{corrupt log')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('clamps the quality warn threshold to its [-1, 1] domain (G3.1 matrix)', () => {
    const cases: Array<[value: number | undefined, expected: number]> = [
      [undefined, -0.25],
      [0, 0],
      [-0.5, -0.5],
      [0.25, 0.25],
      [-1, -1],
      [1, 1],
      [NaN, -0.25],
      [Infinity, -0.25],
      [-Infinity, -0.25],
      [1.5, -0.25],
      [-1.5, -0.25],
    ]
    for (const [value, expected] of cases) {
      expect(Feedback.resolveQualityWarnThreshold({ qualityWarnThreshold: value }), `qualityWarnThreshold=${String(value)}`).toBe(expected)
    }
  })

  it('rejects out-of-domain quality warn threshold at the schema level (G3.1 .min(-1).max(1))', () => {
    const parse = (input: unknown): unknown => (Feedback.Config as unknown as (i: unknown) => unknown)(input)
    expect(() => parse({ qualityWarnThreshold: 1.5 })).toThrow()
    expect(() => parse({ qualityWarnThreshold: -1.5 })).toThrow()
    // 0 and -0.25 are legal; NaN/Infinity sneak through and are clamped at the
    // assembly layer instead.
    expect((parse({ qualityWarnThreshold: 0 }) as { qualityWarnThreshold: number }).qualityWarnThreshold).toBe(0)
    expect((parse({ qualityWarnThreshold: -0.5 }) as { qualityWarnThreshold: number }).qualityWarnThreshold).toBe(-0.5)
    const nanResult = parse({ qualityWarnThreshold: NaN }) as { qualityWarnThreshold: number }
    expect(Number.isNaN(nanResult.qualityWarnThreshold)).toBe(true)
  })
})
