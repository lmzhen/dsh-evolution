import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '../src/index.ts'
import { nodeEvolutionIo, saveUsage } from '@deepseek-ai/dsh-evolution-core'

describe('evolution-curator', () => {
  it('starts stopped by default, runs manually, and persists a run report', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator, { enabled: true, intervalHours: 24 })
    ctx.evolutionCurator.start()
    const result = await ctx.evolutionCurator.run()
    expect(Array.isArray(result.stale)).toBe(true)
    expect(Array.isArray(result.archived)).toBe(true)
    expect(result.report.runId).toBeTruthy()
    expect(await ctx.evolutionCurator.latestReport()).toMatchObject({ runId: result.report.runId })
    ctx.evolutionCurator.stop()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  })

  it('consolidates sources into a target, then restores one from the archive', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-consolidate-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator)
    const skills = ctx.evolutionCurator.skills
    const skill = (name: string, description: string, body: string) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`
    await skills.create('target-skill', skill('target-skill', 't', 'Target body.'), 'foreground')
    await skills.create('source-a', skill('source-a', 'a', 'Body A.'), 'foreground')
    await skills.create('source-b', skill('source-b', 'b', 'Body B.'), 'foreground')
    const result = await ctx.evolutionCurator.consolidate('target-skill', ['source-a', 'source-b'])
    expect(result.ok).toBe(true)
    const merged = await skills.read('target-skill')
    expect(merged).toContain('Body A.')
    expect(merged).toContain('Body B.')
    let names = (await skills.list()).map(item => item.name)
    expect(names).not.toContain('source-a')
    expect(names).not.toContain('source-b')
    const restore = await ctx.evolutionCurator.restore('source-a')
    expect(restore.ok).toBe(true)
    names = (await skills.list()).map(item => item.name)
    expect(names).toContain('source-a')
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('refuses consolidation with a missing target', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-consolidate-bad-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator)
    const result = await ctx.evolutionCurator.consolidate('ghost-target', ['ghost-source'])
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not found')
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('archives a skill that reached the archive threshold (F1 regression)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-archive-threshold-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator, { enabled: true })
    const skills = ctx.evolutionCurator.skills
    const body = (name: string, text: string) => `---\nname: ${name}\ndescription: ${text}\n---\n${text}\n`
    await skills.create('ancient-skill', body('ancient-skill', 'Ancient body.'), 'background_review')
    // Seed an agent-created usage record that is far past the archive
    // threshold. Under the rc.12 bug every such candidate failed because
    // 'Lifecycle: reached archive threshold' was validated as an absorbed-into
    // skill name; this run must archive it cleanly.
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString()
    await saveUsage(skills.root, new Map([['ancient-skill', {
      created_by: 'agent', created_at: old, use_count: 1, view_count: 0, patch_count: 0,
      last_used_at: old, last_viewed_at: null, last_patched_at: null,
      state: 'active', pinned: false, archived_at: null,
    }]]), nodeEvolutionIo())
    const result = await ctx.evolutionCurator.run({ ignoreGates: true })
    expect(result.archived).toContain('ancient-skill')
    expect(result.errors).toEqual([])
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('seeds baseline records for tree skills the sidecar has not seen (F8)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-seed-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator, { enabled: true })
    const skills = ctx.evolutionCurator.skills
    const body = (name: string, text: string) => `---\nname: ${name}\ndescription: ${text}\n---\n${text}\n`
    await skills.create('fresh-skill', body('fresh-skill', 'Fresh body.'), 'foreground')
    const result = await ctx.evolutionCurator.run({ ignoreGates: true })
    // Fresh skill: seeded baseline (clock anchored now) and left untouched.
    expect(result.stale).toEqual([])
    expect(result.archived).toEqual([])
    const usage = await import('@deepseek-ai/dsh-evolution-core').then(m => m.loadUsage(skills.root, nodeEvolutionIo()))
    expect(usage.has('fresh-skill')).toBe(true)
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })
})
