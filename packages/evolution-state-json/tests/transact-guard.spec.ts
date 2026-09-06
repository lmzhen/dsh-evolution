import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as JsonState from '../src/index.ts'
import { jsonTransact } from '../src/index.ts'

async function mount(root: string) {
  const ctx = new Context()
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(JsonState, { root })
  return ctx
}

describe('evolution-state-json jsonTransact record-map task-return guard (V4-08)', () => {
  it('rejects an array task return for a record-map file and writes nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-guard-arr-'))
    const ctx = await mount(root)
    const io = () => ctx.evolutionIo.provider('node')
    await expect(jsonTransact(io, root, 'pending-state.json', () => [])).rejects.toThrow(/task returned an array/)
    expect(await io().exists(join(root, 'pending-state.json'))).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('rejects a scalar task return and leaves an existing record-map file unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-guard-scalar-'))
    const ctx = await mount(root)
    const io = () => ctx.evolutionIo.provider('node')
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
    const before = await io().readText(join(root, 'review-state.json'))
    await expect(jsonTransact(io, root, 'review-state.json', () => 42)).rejects.toThrow(/task returned number/)
    expect(await io().readText(join(root, 'review-state.json'))).toBe(before)
    await rm(root, { recursive: true, force: true })
  })

  it('a null task return (keep) is allowed and persists no file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-guard-null-'))
    const ctx = await mount(root)
    const io = () => ctx.evolutionIo.provider('node')
    await expect(jsonTransact(io, root, 'pending-state.json', () => null)).resolves.toBeUndefined()
    expect(await io().exists(join(root, 'pending-state.json'))).toBe(false)
    await rm(root, { recursive: true, force: true })
  })
})
