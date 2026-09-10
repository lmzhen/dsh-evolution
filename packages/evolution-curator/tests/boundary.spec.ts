import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '../src/index.ts'
import { evolutionHome } from '@deepseek-ai/dsh-evolution-core'

// v21 (T-8): some tests restore DSH_HOME only on the success path — one
// failing assertion used to leak a temp-dir DSH_HOME into later tests in the
// worker. Restore after EVERY test regardless of outcome.
const REAL_DSH_HOME = process.env.DSH_HOME
afterEach(() => {
  if (REAL_DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = REAL_DSH_HOME
})

async function mount(_home: string, config: ConstructorParameters<typeof EvolutionCurator>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(EvolutionCurator, { enabled: true, intervalHours: 24, ...config })
  return ctx
}

describe('evolution-curator boundaries', () => {
  it('D2: a custom config.root points the SkillLibrary at the custom tree (0.3.58)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-root-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const customRoot = join(home, 'custom-skills')
      const ctx = await mount(home, { root: customRoot })
      expect(ctx.evolutionCurator.skills.root).toBe(customRoot)
      // Default (root omitted): resolveSkillsRoot falls back to $DSH_HOME/skills.
      const defaultCtx = await mount(home)
      expect(defaultCtx.evolutionCurator.skills.root).toBe(join(home, 'skills'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

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
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('H-07: setPaused warns when the curator state service is absent (pause not persisted)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-pause-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    // No evolutionState service mounted: the optional-chain form used to make
    // setPaused a silent no-op — the command surface reported success while
    // nothing was persisted. The warn must declare the loss.
    const ctx = await mount(home)
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    await expect(ctx.evolutionCurator.setPaused(true)).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('curator state service absent; pause not persisted'))
    warnSpy.mockRestore()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})
