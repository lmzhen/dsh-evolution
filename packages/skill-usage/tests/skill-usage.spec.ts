import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import SkillUsageRegistry from '../src/index.ts'
import { eventsFile, loadUsage, nodeEvolutionIo, readEvolutionTimeline, saveUsage, skillsRoot } from '@deepseek-ai/dsh-evolution-core'
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

  it('observes skill/skill_load reads through session/event and records views (A2)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-observe-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root, eventsHome: root })
    await ctx.skillUsage.ensureRecord('demo-read')
    const toolCall = (name: string, args: unknown) => ({
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'c1', name, arguments: JSON.stringify(args) },
    }) as never
    ctx.emit('session/event', {} as never, toolCall('skill', { name: 'demo-read' }))
    ctx.emit('session/event', {} as never, toolCall('skill_load', { skill: 'demo-read' }))
    // A non-read tool must not count.
    ctx.emit('session/event', {} as never, toolCall('skill_search', { name: 'demo-read' }))
    await ctx.skillUsage.invalidate()
    const seen = (await ctx.skillUsage.report()).get('demo-read')
    expect(seen?.view_count).toBe(2)
    await rm(root, { recursive: true, force: true })
  })

  it('appends the observation-window anchor once, on the first observed read (C)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-anchor-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root, eventsHome: root })
    await ctx.skillUsage.ensureRecord('anchor-skill')
    const read = (step: number) => {
      ctx.emit('session/event', {} as never, {
        type: 'tool/call',
        data: { turn: 1, step, callId: `c${step}`, name: 'skill', arguments: JSON.stringify({ name: 'anchor-skill' }) },
      } as never)
    }
    read(1)
    read(2)
    await ctx.skillUsage.invalidate()
    const { events } = await readEvolutionTimeline(nodeEvolutionIo(), eventsFile(root))
    const anchors = events.filter(event => event.type === 'usage')
    expect(anchors).toHaveLength(1)
    expect(anchors[0]?.kind).toBe('skill')
    expect(anchors[0]?.source).toBe('observation')
    expect(anchors[0]?.window?.opened).toBeTruthy()
    // Counts are the snapshot at the moment the window opened (first read).
    expect(anchors[0]?.counts?.views).toBe(1)
    await rm(root, { recursive: true, force: true })
  })

  it('does not mint a usage record for a read of an unknown skill (A2 guard)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-no-mint-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    ctx.emit('session/event', {} as never, {
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: JSON.stringify({ name: 'never-created' }) },
    } as never)
    await ctx.skillUsage.invalidate()
    expect((await ctx.skillUsage.report()).has('never-created')).toBe(false)
    await rm(root, { recursive: true, force: true })
  })
})
