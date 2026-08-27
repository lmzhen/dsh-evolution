import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import * as Feedback from '../src/index.ts'
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
    // Pre-existing disk state: one old positive.
    await io.writeText(path, JSON.stringify({ skills: { 'old-skill': { positive: 1, negative: 0 } }, sessions: {} }))
    const feedback = new Feedback.EvolutionFeedback(io, home)
    // Simulate the startup race: restore is already in flight when a record lands.
    const restoring = feedback.restore(io)
    feedback.record('new-skill', 'positive', undefined, 'skill', io)
    await restoring
    await new Promise(resolve => setTimeout(resolve, 20))
    const snapshot = feedback.snapshot()
    expect(snapshot.skills['new-skill']).toBeDefined()
    expect(snapshot.skills['old-skill']?.positive).toBe(1)
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('ignores a malformed feedback file and stays functional', async () => {
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
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })
})
