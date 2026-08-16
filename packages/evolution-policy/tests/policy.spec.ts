import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionPolicy from '../src/index.ts'

describe('evolution-policy', () => {
  it('is immutable to model-shaped mutation fields and protects policy paths', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionPolicy, { protectedPaths: ['/tmp/evo-policy'] })
    expect(ctx.evolutionPolicy.get().memoryChars).toBe(2200)
    expect(ctx.evolutionPolicy.isProtectedPath('/tmp/evo-policy/x.json')).toBe(true)
    expect(ctx.evolutionPolicy.guardReason('memory', { action: 'add', policy: 'x' })).toContain('policy')
    expect(ctx.evolutionPolicy.guardReason('write', { path: '/tmp/evo-policy/x.json' })).toContain('protected')
  })
})
