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
})
