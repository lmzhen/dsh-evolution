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

describe('evolution-state-json state shape gate (G2.2, F-215)', () => {
  it.each([
    ['review-state.json', [], 's1'],
    ['curator-state.json', 42, null],
    ['pending-state.json', 'str', null],
    ['pending.json', [], null],
  ] as [string, unknown, string | null][])(
    'quarantines a valid-JSON but non-object %s as %s',
    async (file, value, sessionId) => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-json-shape-'))
      const ctx = await mount(root)
      const provider = ctx.evolutionStateStorage.provider('json')
      const io = ctx.evolutionIo.provider('node')
      const content = JSON.stringify(value)
      await io.writeText(join(root, file), content)
      const trigger = () => {
        switch (file) {
          case 'review-state.json': return provider.loadReviewState(sessionId as string)
          case 'curator-state.json': return provider.loadCuratorState()
          default: return provider.listPending()
        }
      }
      await expect(trigger()).rejects.toThrow(/not valid JSON/)
      // The corrupt bytes are preserved for operator rescue, never cleared.
      const entries = await io.list(root)
      const corrupt = entries.find(name => name.startsWith(`${file}.corrupt-`))
      expect(corrupt).toBeDefined()
      expect(await io.readText(join(root, corrupt!))).toBe(content)
      expect(await io.readText(join(root, file))).toBe(content)
      await rm(root, { recursive: true, force: true })
    },
  )

  it('a save into a wrong-shape record map rejects and leaves the file untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-shape-save-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'review-state.json'), '[]')
    await expect(provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 }))
      .rejects.toThrow(/not valid JSON/)
    expect(await io.readText(join(root, 'review-state.json'))).toBe('[]')
    await rm(root, { recursive: true, force: true })
  })

  it('loads a well-shaped record map normally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-shape-ok-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
    expect(await provider.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
    await rm(root, { recursive: true, force: true })
  })
})
