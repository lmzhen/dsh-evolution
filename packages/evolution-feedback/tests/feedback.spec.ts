import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import * as Feedback from '../src/index.ts'
import { appendEvolutionEvent, readEvolutionEvents } from '@deepseek-ai/dsh-evolution-core'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../test-support/temp-home.ts'

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

  it('persists across restarts and feeds feedback_warn into skill usage (P1-1, v15)', async () => {
    const home = await tempHome('dsh-feedback-')
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
    // P1-1 (v15): feedback writes the FEEDBACK-OWNED pair — the curator-owned
    // quality_warn stays untouched (scoreTree owns it).
    expect((await ctx.skillUsage.report()).get('python-testing')?.feedback_warn).toBe(true)

    const ctx2 = new Context()
    await ctx2.plugin(EvolutionIoRegistry)
    await ctx2.plugin(NodeIo)
    await ctx2.plugin(Feedback)
    // ctx2's Feedback restores from disk on its fire-and-forget chain; a fixed
    // sleep is load-sensitive (the full parallel suite crossed 20ms), so poll
    // the restored score instead — 0.3.27 release gate.
    const deadline = Date.now() + 5000
    let restoredScore = 0
    while (Date.now() < deadline) {
      restoredScore = ctx2.evolutionFeedback.score('python-testing', 'skill')
      if (Math.abs(restoredScore - -1 / 3) < 1e-9) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(restoredScore).toBeCloseTo(-1 / 3)
    expect(ctx2.evolutionFeedback.snapshot().sessions).toEqual({})
    // 0.3.26 (release gate): ctx2's Feedback is a fresh instance mid-restore —
    // wait for its task chain before removing the temp home, otherwise the
    // background restore write races the recursive rm (ENOTEMPTY at the
    // `evolution/` dir; the §56 fire-and-forget teardown rule).
    await ctx2.evolutionFeedback.waitIdle()

  })

  it('a record made before restore settles survives the restore (merge, not replace)', async () => {
    const home = await tempHome('dsh-feedback-race-')
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
    // 0.3.26: the record chain must settle before the temp home goes away
    // (same ENOTEMPTY teardown race as the restart test above).
    await feedback.waitIdle()
  })

  it('ignores a malformed aggregate and still records into the event log', async () => {
    const home = await tempHome('dsh-feedback-bad-')
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
  })

  it('two instances recording the same target never lose an increment in the event log (rc.68)', async () => {
    const home = await tempHome('dsh-feedback-rc68-')
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
  })

  it('migrates the legacy aggregate into the event log once and rebuilds the cache (rc.68)', async () => {
    const home = await tempHome('dsh-feedback-migrate-')
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
  })

  it('an append after a booted cache does not double-count at the next boot (rc.68)', async () => {
    const home = await tempHome('dsh-feedback-delta-')
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
  })

  it('a concurrent first append does not lose the legacy aggregate (rc.69 migration merge)', async () => {
    const home = await tempHome('dsh-feedback-merge-')
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
    const aggregate = JSON.parse(await io.readText(cachePath) ?? '{}') as Feedback.FeedbackState
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
  })

  it('an empty legacy aggregate does not create an events file (rc.70 F-4)', async () => {
    const home = await tempHome('dsh-feedback-empty-agg-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const io = ctx.evolutionIo.provider('node')
    const eventsPath = join(home, 'evolution', 'events.json')
    await Feedback.migrateFeedbackEvents(io, eventsPath, { skills: {}, sessions: {} })
    expect(await io.readText(eventsPath)).toBeNull()
  })

  it('archives suppress legacy migration: a deleted active is not re-synthesized (rc.71)', async () => {
    const home = await tempHome('dsh-feedback-archive-')
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
  })

  it('a cache below the timeline floor is ignored, never partially folded (rc.72 G-3)', async () => {
    const home = await tempHome('dsh-feedback-floor-')
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
  })

  it('an empty event log is rebuilt on the next record (rc.69)', async () => {
    const home = await tempHome('dsh-feedback-empty-')
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
  })

  it('a malformed event log refuses appends and keeps its bytes (rc.65 posture)', async () => {
    const home = await tempHome('dsh-feedback-events-bad-')
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
  })

  it('skips a feedback event with an invalid rating instead of folding NaN (S6.4)', async () => {
    const home = await tempHome('dsh-feedback-badrating-')
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
  })

  it('skips cache records with an invalid numeric domain (S6.4)', async () => {
    const home = await tempHome('dsh-feedback-badcache-')
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
  })

  it('migrates a zero-count legacy record without dropping its note (S6.4)', async () => {
    const home = await tempHome('dsh-feedback-noteonly-')
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
  })

  it('reclaims the optimistic count after a failed append (S6.4 E-8)', async () => {
    const home = await tempHome('dsh-feedback-rollback-')
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
  })

  it('V4-41: a double failed append never resurrects an unpersisted note (F-324)', async () => {
    const home = await tempHome('dsh-feedback-v4-41-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const io = ctx.evolutionIo.provider('node')
    const eventsPath = join(home, 'evolution', 'events.json')
    // A malformed log refuses BOTH appends — the A/B double-failure shape.
    await io.writeText(eventsPath, '{corrupt log')
    const feedback = new Feedback.EvolutionFeedback(io, home)
    await feedback.restore(io)
    feedback.record('x', 'positive', 'note-A', 'skill')
    feedback.record('x', 'positive', 'note-B', 'skill')
    await feedback.waitIdle()
    const record = feedback.snapshot().skills['x']
    expect(record).toBeDefined()
    // Neither count landed; the note must NOT be restored to the unpersisted
    // 'note-A' (the old code resurrected a value the log never held).
    expect(record?.positive).toBe(0)
    expect(record?.lastNote).toBeUndefined()
  })

  it('V5-28: a later failed append rolls back to the last CONFIRMED note (main branch)', async () => {
    const home = await tempHome('dsh-feedback-v5-28-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const io = ctx.evolutionIo.provider('node')
    const eventsPath = join(home, 'evolution', 'events.json')
    const feedback = new Feedback.EvolutionFeedback(io, home)
    await feedback.restore(io)
    // note-A lands on the log (the confirmed durable truth)…
    feedback.record('x', 'positive', 'note-A', 'skill')
    await feedback.waitIdle()
    // …then the log is "upgraded" so the next append is refused.
    await io.writeText(eventsPath, JSON.stringify({ version: 2, events: [] }, null, 2))
    feedback.record('x', 'positive', 'note-B', 'skill')
    await feedback.waitIdle()
    const record = feedback.snapshot().skills['x']
    // The rollback must restore note-A (last CONFIRMED), never an in-memory
    // optimistic value of a call that never persisted; the failed append's
    // count is rolled back too, leaving exactly the confirmed increment.
    expect(record?.lastNote).toBe('note-A')
    expect(record?.positive).toBe(1)
  })

  it('V4-50: a refused append by a future-version event log is reported through warn', async () => {
    const home = await tempHome('dsh-feedback-v4-50-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const io = ctx.evolutionIo.provider('node')
    const eventsPath = join(home, 'evolution', 'events.json')
    // F-338: a future `version` makes the v1 append refuse and keep bytes.
    await io.writeText(eventsPath, JSON.stringify({ version: 2, events: [] }, null, 2))
    const warns: string[] = []
    const feedback = new Feedback.EvolutionFeedback(io, home, undefined, message => warns.push(message))
    await feedback.restore(io)
    feedback.record('session-1', 'positive')
    feedback.record('session-2', 'positive')
    await feedback.waitIdle()
    // The reject is no longer silent — the injected warn channel observes it.
    expect(warns.some(message => message.includes('version mismatch'))).toBe(true)
    // V5-32: the same refusal is warn-ONCE per cause — a persistent
    // version-mismatch log must not spam on every user entry, even across
    // different targets.
    expect(warns.filter(message => message.includes('version mismatch'))).toHaveLength(1)
    expect(await io.readText(eventsPath)).toContain('"version": 2')
  })

  it('V5-29: a failed append invokes onRollback so derived quality is re-pushed', async () => {
    const home = await tempHome('dsh-feedback-v5-29-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const io = ctx.evolutionIo.provider('node')
    const eventsPath = join(home, 'evolution', 'events.json')
    await io.writeText(eventsPath, '{corrupt log')
    const feedback = new Feedback.EvolutionFeedback(io, home)
    await feedback.restore(io)
    const rollbacks: string[] = []
    feedback.onRollback = (target, kind) => { rollbacks.push(`${kind}:${target}`) }
    feedback.record('x', 'positive', 'note-A', 'skill')
    await feedback.waitIdle()
    // A failed append rolled back IN MEMORY — the derived-state hook fired
    // so a caller (skill-usage quality) can re-push instead of keeping the
    // optimistic score.
    expect(rollbacks).toEqual(['skill:x'])
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
      // An undefined value falls back to the default; the Config field is
      // optional without `| undefined`, so the key is OMITTED for that case
      // (resolveQualityWarnThreshold reads it through `?? -0.25`, making the
      // omitted key and an explicit undefined identical).
      const config = value === undefined ? {} : { qualityWarnThreshold: value }
      expect(Feedback.resolveQualityWarnThreshold(config), `qualityWarnThreshold=${String(value)}`).toBe(expected)
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

  it('V4-44: warns when the quality warn threshold must be clamped at apply time', async () => {
    const ctx = new Context()
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    // Direct assembly bypasses the schema `.min(-1).max(1)`; the apply() clamp
    // must warn loudly. The ctx stays undisposed like the other unit tests —
    // disposing a bare apply() fiber trips the test-invariants host's
    // "settled without becoming active" guard (0.3.28 release gate).
    Feedback.apply(ctx, { qualityWarnThreshold: 1.5 })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('falling back to the default'))
    warnSpy.mockRestore()
  })

  it('V6-40: re-wires quality pushes to a REPLACED skillUsage service (0.3.35)', async () => {
    const ctx = new Context()
    const callsA: string[] = []
    const callsB: string[] = []
    const stubA = { setFeedbackQuality: async (name: string) => { callsA.push(name) } }
    const stubB = { setFeedbackQuality: async (name: string) => { callsB.push(name) } }
    const fiberA = await ctx.plugin({ name: 'stub-skill-usage-a', apply: (c) => { c.provide('skillUsage', stubA) } })
    Feedback.apply(ctx)
    // Establish the wiring on the first instance (the inject fiber activates on
    // a microtask, so record until the push lands).
    const deadlineA = Date.now() + 5000
    while (Date.now() < deadlineA && callsA.length === 0) {
      ctx.evolutionFeedback.record('t', 'negative', undefined, 'skill')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(callsA.length).toBeGreaterThan(0)
    // Replace the dependency: without the re-wire (the old one-time flag
    // skipped the second inject run) quality pushes would keep going into the
    // UNLOADED instance and the new one would never receive them.
    await fiberA.dispose()
    const fiberB = await ctx.plugin({ name: 'stub-skill-usage-b', apply: (c) => { c.provide('skillUsage', stubB) } })
    const deadlineB = Date.now() + 5000
    while (Date.now() < deadlineB && callsB.length === 0) {
      ctx.evolutionFeedback.record('t2', 'negative', undefined, 'skill')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(callsB.length).toBeGreaterThan(0)
    await fiberB.dispose()
  })

  it('V6-39: a whitespace-only path falls back to the default feedback path (0.3.35)', async () => {
    const home = await tempHome('dsh-feedback-path-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(Feedback, { path: '   ' })
    ctx.evolutionFeedback.record('target', 'positive', 'note', 'session')
    await ctx.evolutionFeedback.waitIdle()
    await ctx.evolutionFeedback.persistCache()
    // The boot cache lands on the DEFAULT path — a whitespace `path` was
    // truthy pre-fix and produced a CWD-relative ' ' file instead.
    expect(await readFile(join(home, 'evolution', 'feedback.json'), 'utf8')).toContain('"version": 2')
    await expect(readFile(join(process.cwd(), '   '), 'utf8')).rejects.toThrow()
  })

  it('N7 (v12): restore caps the durable-note seed at the 512 bound like the record path', async () => {
    await tempHome('dsh-feedback-n7-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(Feedback)
    // 513 distinct feedbacked targets — just past NOTE_CAP (512). The record
    // path evicts on insert, but the restore() seed path previously
    // re-seeded the whole map unbounded, leaving a >512 deployment over the
    // bound forever (kept at 513 so the suite stays fast under load).
    for (let i = 0; i < 513; i += 1) ctx.evolutionFeedback.record(`t-${i}`, 'positive', `note-${i}`, 'skill')
    await ctx.evolutionFeedback.waitIdle()
    const ctx2 = new Context()
    await ctx2.plugin(EvolutionIoRegistry)
    await ctx2.plugin(NodeIo)
    await ctx2.plugin(Feedback)
    await ctx2.evolutionFeedback.waitIdle()
    const notes = (ctx2.evolutionFeedback as unknown as { durableNote: Map<string, unknown> }).durableNote
    expect(notes.size).toBeLessThanOrEqual(512)
  }, 60_000)

  it('V24-05: a corrupted aggregate is sanitized before migration (no event explosion, no type lie)', async () => {
    const home = await tempHome('dsh-feedback-sanitize-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const io = ctx.evolutionIo.provider('node')
    const cachePath = join(home, 'evolution', 'feedback.json')
    const eventsPath = join(home, 'evolution', 'events.json')
    // Corrupted aggregate (hand-edited / damaged file) with NO event log —
    // exactly the recovery scenario the migration path exists for.
    // 'huge-skill' carries an impossible count (pre-fix: a billion-element
    // event array at boot); 'note-skill' carries a non-string lastNote
    // (pre-fix: flowed into the folded record as a type lie); 'good-skill'
    // is a legitimate record that must survive.
    await io.writeText(cachePath, JSON.stringify({
      skills: {
        'huge-skill': { positive: 1e9, negative: 0 },
        'note-skill': { positive: 1, negative: 0, lastNote: 12345 },
        'good-skill': { positive: 2, negative: 0 },
      },
      sessions: {},
    }))
    const feedback = new Feedback.EvolutionFeedback(io, home)
    await feedback.restore(io)
    await feedback.waitIdle()
    const events = (await readEvolutionEvents(io, eventsPath)).events
    const countFor = (target: string): number => events.filter(event => event.type === 'feedback' && event.target === target).length
    // The impossible count was clamped to the migration budget, not expanded.
    expect(countFor('huge-skill')).toBe(10_000)
    // The type-broken record was dropped by the shared sanitizer.
    expect(countFor('note-skill')).toBe(0)
    expect(feedback.snapshot().skills['note-skill']).toBeUndefined()
    // The well-formed record migrated intact.
    expect(countFor('good-skill')).toBe(2)
    expect(feedback.snapshot().skills['good-skill']).toMatchObject({ positive: 2, negative: 0 })
  }, 60_000)
})
