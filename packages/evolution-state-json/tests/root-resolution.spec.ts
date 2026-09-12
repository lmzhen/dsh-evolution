import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tempHome, tempRoot } from '../../test-support/temp-home.ts'
import { mountStateStack } from '../../test-support/state-stack.ts'


describe('evolution-state-json root resolution (V4-09)', () => {
  it('a whitespace-only root falls through to the evolution home', async () => {
    const dshHome = await tempHome('dsh-json-root-')
    const ctx = await mountStateStack('   ')
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    // ' ' is truthy but must NOT be used as the root (CWD-relative); the
    // provider resolves through evolutionHome() = <DSH_HOME>/evolution.
    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
    expect(await io.exists(join(dshHome, 'evolution', 'review-state.json'))).toBe(true)
  })

  it('an empty root falls through to the evolution home', async () => {
    const dshHome = await tempHome('dsh-json-root2-')
    const ctx = await mountStateStack('')
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
    expect(await io.exists(join(dshHome, 'evolution', 'review-state.json'))).toBe(true)
  })

  it('an explicit root wins over the evolution home', async () => {
    const root = await tempRoot('dsh-json-root3-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
    expect(await provider.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
  })
})
