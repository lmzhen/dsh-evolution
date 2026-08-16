import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillUsageRegistry from '../src/index.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('skill-usage', () => {
  it('records use and persists to disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-'))
    const ctx = new Context()
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'use')
    expect((await ctx.skillUsage.report()).get('demo')?.use_count).toBe(1)
    await rm(root, { recursive: true, force: true })
  })
})
