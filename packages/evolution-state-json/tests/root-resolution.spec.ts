import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as JsonState from '../src/index.ts'

async function mount(root: string) {
  const ctx = new Context()
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(JsonState, { root })
  return ctx
}

describe('evolution-state-json root resolution (V4-09)', () => {
  it('a whitespace-only root falls through to the evolution home', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-json-root-'))
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = dshHome
    try {
      const ctx = await mount('   ')
      const provider = ctx.evolutionStateStorage.provider('json')
      const io = ctx.evolutionIo.provider('node')
      // ' ' is truthy but must NOT be used as the root (CWD-relative); the
      // provider resolves through evolutionHome() = <DSH_HOME>/evolution.
      await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
      expect(await io.exists(join(dshHome, 'evolution', 'review-state.json'))).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('an empty root falls through to the evolution home', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-json-root2-'))
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = dshHome
    try {
      const ctx = await mount('')
      const provider = ctx.evolutionStateStorage.provider('json')
      const io = ctx.evolutionIo.provider('node')
      await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
      expect(await io.exists(join(dshHome, 'evolution', 'review-state.json'))).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('an explicit root wins over the evolution home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-root3-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
    expect(await provider.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
    await rm(root, { recursive: true, force: true })
  })
})
