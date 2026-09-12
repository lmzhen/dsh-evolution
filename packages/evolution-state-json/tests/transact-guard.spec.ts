import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { jsonTransact } from '../src/index.ts'
import { tempRoot } from '../../test-support/temp-home.ts'
import { mountStateStack } from '../../test-support/state-stack.ts'


describe('evolution-state-json jsonTransact record-map task-return guard (V4-08)', () => {
  it('rejects an array task return for a record-map file and writes nothing', async () => {
    const root = await tempRoot('dsh-json-guard-arr-')
    const ctx = await mountStateStack(root)
    const io = () => ctx.evolutionIo.provider('node')
    await expect(jsonTransact(ctx, io, root, 'pending-state.json', () => [])).rejects.toThrow(/task returned an array/)
    expect(await io().exists(join(root, 'pending-state.json'))).toBe(false)
  })

  it('rejects a scalar task return and leaves an existing record-map file unchanged', async () => {
    const root = await tempRoot('dsh-json-guard-scalar-')
    const ctx = await mountStateStack(root)
    const io = () => ctx.evolutionIo.provider('node')
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
    const before = await io().readText(join(root, 'review-state.json'))
    await expect(jsonTransact(ctx, io, root, 'review-state.json', () => 42)).rejects.toThrow(/task returned number/)
    expect(await io().readText(join(root, 'review-state.json'))).toBe(before)
  })

  it('a null task return (ensure-absent) is allowed and persists no file', async () => {
    const root = await tempRoot('dsh-json-guard-null-')
    const ctx = await mountStateStack(root)
    const io = () => ctx.evolutionIo.provider('node')
    await expect(jsonTransact(ctx, io, root, 'pending-state.json', () => null)).resolves.toBeUndefined()
    expect(await io().exists(join(root, 'pending-state.json'))).toBe(false)
  })
})
