import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '../src/index.ts'

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
    await rm(home, { recursive: true, force: true })
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
    await skills.create('target-skill', skill('target-skill', 't', 'Target body.'))
    await skills.create('source-a', skill('source-a', 'a', 'Body A.'))
    await skills.create('source-b', skill('source-b', 'b', 'Body B.'))
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
})
