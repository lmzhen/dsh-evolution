import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import SkillUsageRegistry from '../src/index.ts'
import { loadUsage, saveUsage, nodeEvolutionIo, skillsRoot } from '@deepseek-ai/dsh-evolution-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('skill-usage', () => {
  it('records use and persists to disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'use')
    expect((await ctx.skillUsage.report()).get('demo')?.use_count).toBe(1)
    await rm(root, { recursive: true, force: true })
  })

  it('markArchived sets state without bumping the patch counter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-archive-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'patch')
    await ctx.skillUsage.markArchived('demo')
    const record = (await ctx.skillUsage.report()).get('demo')
    expect(record?.state).toBe('archived')
    expect(record?.archived_at).toBeTruthy()
    expect(record?.patch_count).toBe(1)
    await rm(root, { recursive: true, force: true })
  })

  it('invalidate() re-reads external writes instead of re-covering them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-invalidate-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'use')
    // The curator writes the sidecar directly (simulated here as an external
    // quality/state update), then invalidates the registry cache.
    const usage = await loadUsage(root, nodeEvolutionIo())
    const record = usage.get('demo')
    if (record) record.quality_score = 0.9
    await saveUsage(root, usage, nodeEvolutionIo())
    await ctx.skillUsage.invalidate()
    // A subsequent telemetry write must not re-cover the external quality change.
    await ctx.skillUsage.record('demo', 'view')
    const seen = (await ctx.skillUsage.report()).get('demo')
    expect(seen?.quality_score).toBe(0.9)
    expect(seen?.view_count).toBe(1)
    await rm(root, { recursive: true, force: true })
  })

  it('falls back to skillsRoot() when root is unset or empty (P0-3)', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    // No `{ root }`: schemastery's default('') must not win over the real path.
    await ctx.plugin(SkillUsageRegistry)
    expect(ctx.skillUsage.root).toBe(skillsRoot())
  })
})
