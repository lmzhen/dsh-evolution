import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '../src/index.ts'
import { evolutionHome } from '@deepseek-ai/dsh-evolution/src/state-store.ts'

async function mount(_home: string, config: ConstructorParameters<typeof EvolutionCurator>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(EvolutionCurator, { enabled: true, intervalHours: 24, ...config })
  return ctx
}

describe('evolution-curator boundaries', () => {
  it('skips an automatic run while a session is recently active', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-idle-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = await mount(home, { minIdleHours: 1 })
    ctx.provide('agents', {
      list: () => [{ session: { events: [{ type: 'turn/start', seq: 1, time: Date.now(), data: { turn: 1 } }] } }],
    })
    const result = await ctx.evolutionCurator.run()
    expect(result.skipped).toBe('active-session')
    expect(result.stale).toEqual([])
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('ignores a malformed report file instead of crashing the report reader', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-report-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = await mount(home)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(evolutionHome(), 'reports', 'curator-bad.json'), '{broken')
    expect(await ctx.evolutionCurator.latestReport()).toBeNull()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })
})
