import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Commands from '../src/index.ts'

describe('evolution-commands', () => {
  it('loads without the commands service mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(Commands, {})
    expect(ctx.get('commands')).toBeUndefined()
  })
})
